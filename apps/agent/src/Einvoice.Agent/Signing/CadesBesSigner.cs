using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Org.BouncyCastle.Asn1;
using Org.BouncyCastle.Asn1.Cms;
using Org.BouncyCastle.Asn1.Ess;
using Org.BouncyCastle.Asn1.Nist;
using Org.BouncyCastle.Asn1.Pkcs;
using Org.BouncyCastle.Asn1.X509;
using Org.BouncyCastle.Cms;
using Org.BouncyCastle.Crypto;
using Org.BouncyCastle.OpenSsl;
using Org.BouncyCastle.Security;
using Attribute = Org.BouncyCastle.Asn1.Cms.Attribute;
using CmsAttributeTable = Org.BouncyCastle.Asn1.Cms.AttributeTable;
using BcX509 = Org.BouncyCastle.X509.X509Certificate;

namespace Einvoice.Agent.Signing;

/// <summary>
/// Detached CAdES-BES (ETA Digital Signature Format V1.1) via BouncyCastle.
/// Structural FR-011 contract — do not byte-compare to reference Cades.txt.
/// </summary>
public static partial class CadesBesSigner
{
    public static readonly DerObjectIdentifier DigestedDataOid =
        PkcsObjectIdentifiers.DigestedData;

    public static readonly DerObjectIdentifier Sha256Oid = NistObjectIdentifiers.IdSha256;

    public static readonly DerObjectIdentifier EssSigningCertificateV2Oid =
        PkcsObjectIdentifiers.IdAASigningCertificateV2;

    public static byte[] SignDetached(byte[] contentUtf8, X509Certificate2 signerCert)
    {
        ArgumentNullException.ThrowIfNull(contentUtf8);
        ArgumentNullException.ThrowIfNull(signerCert);

        var bcCert = new Org.BouncyCastle.X509.X509CertificateParser()
            .ReadCertificate(signerCert.RawData);
        var privKey = ResolvePrivateKey(signerCert);
        return SignDetached(contentUtf8, privKey, bcCert);
    }

    public static byte[] SignDetached(
        byte[] contentUtf8,
        AsymmetricKeyParameter privateKey,
        BcX509 bcCert)
    {
        ArgumentNullException.ThrowIfNull(contentUtf8);
        ArgumentNullException.ThrowIfNull(privateKey);
        ArgumentNullException.ThrowIfNull(bcCert);

        var generator = new CmsSignedDataGenerator();
        var signedAttrGen = new EtaSignedAttributeTableGenerator(bcCert);
        generator.AddSigner(
            privateKey,
            bcCert,
            CmsSignedGenerator.DigestSha256,
            signedAttrGen,
            null);
        generator.AddCertificate(bcCert);

        var typed = new CmsProcessableByteArray(contentUtf8);
        var signed = generator.Generate(DigestedDataOid.Id, typed, encapsulate: false);
        return signed.GetEncoded();
    }

    public static string SignDetachedBase64(byte[] contentUtf8, X509Certificate2 signerCert) =>
        Convert.ToBase64String(SignDetached(contentUtf8, signerCert));

    public static string SignCanonicalBase64(string canonical, X509Certificate2 signerCert) =>
        SignDetachedBase64(Encoding.UTF8.GetBytes(canonical), signerCert);

    public static AsymmetricKeyParameter LoadPrivateKeyPem(string pem)
    {
        using var reader = new StringReader(pem);
        var pemReader = new PemReader(reader);
        var obj = pemReader.ReadObject();
        return obj switch
        {
            AsymmetricCipherKeyPair pair => pair.Private,
            AsymmetricKeyParameter key => key,
            _ => throw new InvalidOperationException($"Unsupported PEM object: {obj?.GetType().Name}"),
        };
    }

    public static BcX509 LoadCertificatePem(string pem)
    {
        using var reader = new StringReader(pem);
        var pemReader = new PemReader(reader);
        var obj = pemReader.ReadObject();
        if (obj is BcX509 cert) return cert;
        throw new InvalidOperationException("PEM did not contain an X.509 certificate");
    }

    public static bool Verify(byte[] cadesDer, byte[] contentUtf8)
    {
        var signed = new CmsSignedData(
            new CmsProcessableByteArray(contentUtf8),
            cadesDer);
        foreach (SignerInformation signer in signed.GetSignerInfos().GetSigners())
        {
            foreach (BcX509 cert in signed.GetCertificates().EnumerateMatches(signer.SignerID))
            {
                if (signer.Verify(cert))
                    return true;
            }
        }

        return false;
    }

    private static AsymmetricKeyParameter ResolvePrivateKey(X509Certificate2 signerCert)
    {
        using var rsa = signerCert.GetRSAPrivateKey()
            ?? throw new InvalidOperationException("Signer certificate has no RSA private key");
        try
        {
            return DotNetUtilities.GetRsaKeyPair(rsa).Private;
        }
        catch (CryptographicException)
        {
            var pkcs8 = rsa.ExportPkcs8PrivateKey();
            return PrivateKeyFactory.CreateKey(pkcs8);
        }
    }
}

internal sealed class EtaSignedAttributeTableGenerator : CmsAttributeTableGenerator
{
    private readonly BcX509 _cert;

    public EtaSignedAttributeTableGenerator(BcX509 cert) => _cert = cert;

    public CmsAttributeTable GetAttributes(IDictionary<CmsAttributeTableParameter, object> parameters)
    {
        var attrs = new Dictionary<DerObjectIdentifier, Attribute>();

        attrs[CmsAttributes.ContentType] = new Attribute(
            CmsAttributes.ContentType,
            new DerSet(CadesBesSigner.DigestedDataOid));

        if (parameters.TryGetValue(CmsAttributeTableParameter.Digest, out var digestObj)
            && digestObj is byte[] digest)
        {
            attrs[CmsAttributes.MessageDigest] = new Attribute(
                CmsAttributes.MessageDigest,
                new DerSet(new DerOctetString(digest)));
        }

        attrs[CmsAttributes.SigningTime] = new Attribute(
            CmsAttributes.SigningTime,
            new DerSet(new Org.BouncyCastle.Asn1.Cms.Time(DateTime.UtcNow)));

        var certHash = DigestUtilities.CalculateDigest("SHA-256", _cert.GetEncoded());
        var essCert = new EssCertIDv2(new AlgorithmIdentifier(CadesBesSigner.Sha256Oid), certHash);
        var signingCertV2 = new SigningCertificateV2(new[] { essCert });
        attrs[CadesBesSigner.EssSigningCertificateV2Oid] = new Attribute(
            CadesBesSigner.EssSigningCertificateV2Oid,
            new DerSet(signingCertV2));

        var table = new Dictionary<DerObjectIdentifier, object>();
        foreach (var kv in attrs)
            table[kv.Key] = kv.Value;
        return new CmsAttributeTable(table);
    }
}
