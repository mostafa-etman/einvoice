using System.Text;
using Einvoice.Agent.Signing;
using Org.BouncyCastle.Asn1;
using Org.BouncyCastle.Asn1.Cms;
using Org.BouncyCastle.Asn1.Nist;
using Org.BouncyCastle.Asn1.Pkcs;
using Org.BouncyCastle.Asn1.X509;
using Org.BouncyCastle.Cms;
using Org.BouncyCastle.Crypto;
using Xunit;
using CmsContentInfo = Org.BouncyCastle.Asn1.Cms.ContentInfo;
using CmsSignedDataAsn1 = Org.BouncyCastle.Asn1.Cms.SignedData;
using BcX509 = Org.BouncyCastle.X509.X509Certificate;

namespace Einvoice.Agent.Tests;

public class CadesStructureTests
{
    private static (AsymmetricKeyParameter Key, BcX509 Cert) LoadTestMaterial()
    {
        var dir = TestKeysDir();
        var key = CadesBesSigner.LoadPrivateKeyPem(File.ReadAllText(Path.Combine(dir, "software-test.key.pem")));
        var cert = CadesBesSigner.LoadCertificatePem(File.ReadAllText(Path.Combine(dir, "software-test.cer.pem")));
        return (key, cert);
    }

    private static string TestKeysDir()
    {
        foreach (var start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
        {
            var cur = new DirectoryInfo(start);
            while (cur != null)
            {
                var a = Path.Combine(cur.FullName, "TestKeys");
                if (Directory.Exists(a)) return a;
                var b = Path.Combine(cur.FullName, "apps", "agent", "tests", "Einvoice.Agent.Tests", "TestKeys");
                if (Directory.Exists(b)) return b;
                cur = cur.Parent;
            }
        }

        throw new DirectoryNotFoundException("TestKeys not found");
    }

    private static (byte[] Der, byte[] Content) SignSample()
    {
        var (key, cert) = LoadTestMaterial();
        var content = Encoding.UTF8.GetBytes("\"TEST\"\"value\"");
        return (CadesBesSigner.SignDetached(content, key, cert), content);
    }

    private static SignerInformation FirstSigner(CmsSignedData cms) =>
        cms.GetSignerInfos().GetSigners().Cast<SignerInformation>().First();

    private static Org.BouncyCastle.Asn1.Cms.AttributeTable SignedAttrs(CmsSignedData cms) =>
        FirstSigner(cms).SignedAttributes
        ?? throw new InvalidOperationException("missing signed attributes");

    [Fact]
    public void T023a_detached_DigestedData_eContent_absent()
    {
        var (der, _) = SignSample();
        var outer = CmsContentInfo.GetInstance(Asn1Object.FromByteArray(der));
        var signedData = CmsSignedDataAsn1.GetInstance(outer.Content);
        Assert.Null(signedData.EncapContentInfo.Content);
        Assert.Equal(CadesBesSigner.DigestedDataOid, signedData.EncapContentInfo.ContentType);
    }

    [Fact]
    public void T023b_digest_algorithm_sha256_oid()
    {
        var (der, _) = SignSample();
        var outer = CmsContentInfo.GetInstance(Asn1Object.FromByteArray(der));
        var signedData = CmsSignedDataAsn1.GetInstance(outer.Content);
        var algs = signedData.DigestAlgorithms.ToArray()
            .Select(AlgorithmIdentifier.GetInstance);
        Assert.Contains(algs, a => a.Algorithm.Equals(NistObjectIdentifiers.IdSha256));
        Assert.Equal(NistObjectIdentifiers.IdSha256, FirstSigner(new CmsSignedData(der)).DigestAlgorithmID.Algorithm);
    }

    [Fact]
    public void T023c_content_type_message_digest_signing_time_present()
    {
        var (der, _) = SignSample();
        var attrs = SignedAttrs(new CmsSignedData(der));
        Assert.NotNull(attrs[CmsAttributes.ContentType]);
        Assert.NotNull(attrs[CmsAttributes.MessageDigest]);
        Assert.NotNull(attrs[CmsAttributes.SigningTime]);
        Assert.Equal(CadesBesSigner.DigestedDataOid, (DerObjectIdentifier)attrs[CmsAttributes.ContentType].AttrValues[0]);
    }

    [Fact]
    public void T023d_ess_signing_certificate_v2_present()
    {
        var (der, _) = SignSample();
        var attrs = SignedAttrs(new CmsSignedData(der));
        Assert.NotNull(attrs[CadesBesSigner.EssSigningCertificateV2Oid]
            ?? attrs[PkcsObjectIdentifiers.IdAASigningCertificateV2]);
    }

    [Fact]
    public void T023e_signatureType_I_from_pipeline()
    {
        var (key, cert) = LoadTestMaterial();
        var result = SignPipeline.SignDocumentJson("""{"x":1}""", key, cert);
        Assert.Equal("I", result.SignatureType);
    }

    [Fact]
    public void T023f_cryptographic_verify_succeeds()
    {
        var (der, content) = SignSample();
        Assert.True(CadesBesSigner.Verify(der, content));
    }
}

public class CadesSoftwareKeyGoldenTests
{
    private static string FindDir(params string[] parts)
    {
        foreach (var start in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            var cur = new DirectoryInfo(start);
            while (cur != null)
            {
                var candidate = Path.Combine(new[] { cur.FullName }.Concat(parts).ToArray());
                if (Directory.Exists(candidate)) return candidate;
                cur = cur.Parent;
            }
        }

        throw new DirectoryNotFoundException(string.Join('/', parts));
    }

    [Fact]
    public void T023g_software_key_signs_gv01_full_fr011_checklist()
    {
        var root = FindDir("specs", "005-document-building-serialization", "golden-vectors");
        var keys = FindDir("apps", "agent", "tests", "Einvoice.Agent.Tests", "TestKeys");
        if (!Directory.Exists(keys))
            keys = FindDir("TestKeys");

        var input = File.ReadAllText(Path.Combine(root, "gv-01-eta-sdk-one-doc.input.json"), Encoding.UTF8);
        var expectedCanon = File.ReadAllText(Path.Combine(root, "gv-01-eta-sdk-one-doc.canonical.txt"), Encoding.UTF8)
            .TrimEnd('\n');

        var key = CadesBesSigner.LoadPrivateKeyPem(File.ReadAllText(Path.Combine(keys, "software-test.key.pem")));
        var cert = CadesBesSigner.LoadCertificatePem(File.ReadAllText(Path.Combine(keys, "software-test.cer.pem")));

        var withSig = SigningInput.ParseDocument(input);
        withSig["signatures"] = new Newtonsoft.Json.Linq.JArray(
            new Newtonsoft.Json.Linq.JObject { ["signatureType"] = "I", ["value"] = "dummy" });

        var result = SignPipeline.SignDocument(withSig, key, cert);
        Assert.Equal("I", result.SignatureType);
        Assert.Equal(expectedCanon, result.Canonical);

        var der = Convert.FromBase64String(result.CadesBase64);
        var outer = CmsContentInfo.GetInstance(Asn1Object.FromByteArray(der));
        var signedData = CmsSignedDataAsn1.GetInstance(outer.Content);
        Assert.Null(signedData.EncapContentInfo.Content);
        Assert.Equal(CadesBesSigner.DigestedDataOid, signedData.EncapContentInfo.ContentType);

        var cms = new CmsSignedData(der);
        var signer = cms.GetSignerInfos().GetSigners().Cast<SignerInformation>().First();
        Assert.Equal(NistObjectIdentifiers.IdSha256, signer.DigestAlgorithmID.Algorithm);
        var attrs = signer.SignedAttributes!;
        Assert.NotNull(attrs[CmsAttributes.ContentType]);
        Assert.NotNull(attrs[CmsAttributes.MessageDigest]);
        Assert.NotNull(attrs[CmsAttributes.SigningTime]);
        Assert.NotNull(attrs[PkcsObjectIdentifiers.IdAASigningCertificateV2]
            ?? attrs[CadesBesSigner.EssSigningCertificateV2Oid]);
        Assert.True(CadesBesSigner.Verify(der, result.ContentUtf8));
    }
}
