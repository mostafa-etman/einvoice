using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Org.BouncyCastle.Asn1.Pkcs;
using Org.BouncyCastle.Asn1.X509;
using Org.BouncyCastle.Cms;
using Org.BouncyCastle.Crypto;
using Org.BouncyCastle.Security;
using BcX509 = Org.BouncyCastle.X509.X509Certificate;

namespace Einvoice.Agent.Signing;

public sealed class DotNetRsaSignatureFactory : ISignatureFactory
{
    private readonly RSA _rsa;

    public DotNetRsaSignatureFactory(RSA rsa) => _rsa = rsa;

    public object AlgorithmDetails { get; } =
        new AlgorithmIdentifier(PkcsObjectIdentifiers.Sha256WithRsaEncryption);

    public IStreamCalculator<IBlockResult> CreateCalculator() => new Calculator(_rsa);

    private sealed class Calculator : IStreamCalculator<IBlockResult>
    {
        private readonly RSA _rsa;
        private readonly MemoryStream _stream = new();

        public Calculator(RSA rsa) => _rsa = rsa;

        public Stream Stream => _stream;

        public IBlockResult GetResult()
        {
            var data = _stream.ToArray();
            var sig = _rsa.SignData(data, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            return new SimpleBlockResult(sig);
        }
    }
}

public sealed class Pkcs11SignatureFactory : ISignatureFactory
{
    private readonly Func<byte[], byte[]> _sign;

    public Pkcs11SignatureFactory(Func<byte[], byte[]> signRawThenSha256RsaPkcs) =>
        _sign = signRawThenSha256RsaPkcs;

    public object AlgorithmDetails { get; } =
        new AlgorithmIdentifier(PkcsObjectIdentifiers.Sha256WithRsaEncryption);

    public IStreamCalculator<IBlockResult> CreateCalculator() => new Calculator(_sign);

    private sealed class Calculator : IStreamCalculator<IBlockResult>
    {
        private readonly Func<byte[], byte[]> _sign;
        private readonly MemoryStream _stream = new();

        public Calculator(Func<byte[], byte[]> sign) => _sign = sign;

        public Stream Stream => _stream;

        public IBlockResult GetResult() => new SimpleBlockResult(_sign(_stream.ToArray()));
    }
}

public static partial class CadesBesSigner
{
    public static byte[] SignDetached(byte[] contentUtf8, RSA privateKey, X509Certificate2 signerCert)
    {
        ArgumentNullException.ThrowIfNull(privateKey);
        var bcCert = new Org.BouncyCastle.X509.X509CertificateParser().ReadCertificate(signerCert.RawData);
        return SignDetachedWithFactory(contentUtf8, new DotNetRsaSignatureFactory(privateKey), bcCert);
    }

    public static byte[] SignDetachedWithFactory(
        byte[] contentUtf8,
        ISignatureFactory signatureFactory,
        BcX509 bcCert)
    {
        ArgumentNullException.ThrowIfNull(contentUtf8);
        ArgumentNullException.ThrowIfNull(signatureFactory);
        ArgumentNullException.ThrowIfNull(bcCert);

        var signedAttrGen = new EtaSignedAttributeTableGenerator(bcCert);
        var signerInfoGen = new SignerInfoGeneratorBuilder()
            .WithSignedAttributeGenerator(signedAttrGen)
            .Build(signatureFactory, bcCert);

        var generator = new CmsSignedDataGenerator();
        generator.AddSignerInfoGenerator(signerInfoGen);
        generator.AddCertificate(bcCert);

        var typed = new CmsProcessableByteArray(contentUtf8);
        var signed = generator.Generate(DigestedDataOid.Id, typed, encapsulate: false);
        return signed.GetEncoded();
    }
}
