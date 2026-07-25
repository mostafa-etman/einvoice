using System.Security.Cryptography.X509Certificates;
using System.Text;
using Org.BouncyCastle.Crypto;
using BcX509 = Org.BouncyCastle.X509.X509Certificate;

namespace Einvoice.Agent.Signing;

/// <summary>
/// strip → canonicalize → CAdES-BES (detached) → Base64 value + type "I".
/// Provider-agnostic: pass <see cref="ISigningProvider"/> for production paths.
/// </summary>
public static class SignPipeline
{
    public const string IssuerSignatureType = "I";

    public sealed record Result(
        string SignatureType,
        string CadesBase64,
        string Canonical,
        byte[] ContentUtf8,
        string? SourceLabel = null,
        string? CertificateThumbprint = null);

    /// <summary>Primary path: strip → canonicalize → provider.Sign → type "I".</summary>
    public static Result SignDocumentJson(string documentJson, ISigningProvider provider, string? pin)
    {
        ArgumentNullException.ThrowIfNull(provider);
        var canonical = SigningInput.CanonicalWithoutSignaturesFromJson(documentJson);
        var content = Encoding.UTF8.GetBytes(canonical);
        using var outcome = provider.Sign(content, pin);
        return new Result(
            IssuerSignatureType,
            Convert.ToBase64String(outcome.CadesDer),
            canonical,
            content,
            outcome.SourceLabel,
            outcome.Certificate.Thumbprint);
    }

    public static Result SignDocumentJson(string documentJson, X509Certificate2 signerCert) =>
        SignDocument(SigningInput.ParseDocument(documentJson), signerCert);

    public static Result SignDocument(Newtonsoft.Json.Linq.JObject document, X509Certificate2 signerCert)
    {
        var canonical = SigningInput.CanonicalWithoutSignatures(document);
        var content = Encoding.UTF8.GetBytes(canonical);
        var cades = CadesBesSigner.SignDetachedBase64(content, signerCert);
        return new Result(IssuerSignatureType, cades, canonical, content);
    }

    public static Result SignDocument(
        Newtonsoft.Json.Linq.JObject document,
        AsymmetricKeyParameter privateKey,
        BcX509 certificate)
    {
        var canonical = SigningInput.CanonicalWithoutSignatures(document);
        var content = Encoding.UTF8.GetBytes(canonical);
        var cades = Convert.ToBase64String(CadesBesSigner.SignDetached(content, privateKey, certificate));
        return new Result(IssuerSignatureType, cades, canonical, content);
    }

    public static Result SignDocumentJson(
        string documentJson,
        AsymmetricKeyParameter privateKey,
        BcX509 certificate) =>
        SignDocument(SigningInput.ParseDocument(documentJson), privateKey, certificate);
}
