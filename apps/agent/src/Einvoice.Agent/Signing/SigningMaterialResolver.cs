namespace Einvoice.Agent.Signing;

/// <summary>
/// Low-level helper: CAdES over a <see cref="TokenSigningContext"/> (PKCS#11/CSP session).
/// Prefer <see cref="ISigningProvider"/> for application code.
/// </summary>
public static class SigningMaterialResolver
{
    public static byte[] SignContent(TokenSigningContext ctx, byte[] contentUtf8)
    {
        if (ctx.BcPrivateKey is not null && ctx.BcCertificate is not null)
            return CadesBesSigner.SignDetached(contentUtf8, ctx.BcPrivateKey, ctx.BcCertificate);

        if (ctx.SignatureFactory is null)
            throw new InvalidOperationException("TokenSigningContext has no signature factory.");

        var bcCert = ctx.BcCertificate
            ?? new Org.BouncyCastle.X509.X509CertificateParser().ReadCertificate(ctx.Certificate.RawData);
        return CadesBesSigner.SignDetachedWithFactory(contentUtf8, ctx.SignatureFactory, bcCert);
    }
}
