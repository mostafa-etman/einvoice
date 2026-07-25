using System.Security.Cryptography.X509Certificates;
using System.Text;
using Einvoice.Agent.Config;
using Org.BouncyCastle.Crypto;
using BcX509 = Org.BouncyCastle.X509.X509Certificate;

namespace Einvoice.Agent.Signing;

/// <summary>
/// Resolves software vs PKCS#11 vs CSP signing material from <see cref="AgentSettings"/>.
/// Hardware paths require a PIN; software path ignores PIN.
/// </summary>
public sealed class SigningMaterialResolver
{
    private readonly AgentSettings _settings;

    public SigningMaterialResolver(AgentSettings settings) => _settings = settings;

    public TokenSigningContext Acquire(string? pin)
    {
        return _settings.SigningKeySource switch
        {
            SigningKeySource.Software => AcquireSoftware(),
            SigningKeySource.Pkcs11 => AcquirePkcs11(RequirePin(pin)),
            SigningKeySource.Csp => AcquireCsp(pin ?? ""),
            SigningKeySource.Auto => AcquireAuto(pin),
            _ => throw new InvalidOperationException($"Unknown signing source: {_settings.SigningKeySource}"),
        };
    }

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

    private TokenSigningContext AcquireAuto(string? pin)
    {
        Exception? pkcs11Error = null;
        var lib = _settings.Pkcs11LibraryPath ?? Pkcs11KeyProvider.ProbeDefaultLibraryPath();
        if (!string.IsNullOrWhiteSpace(lib) && File.Exists(lib))
        {
            try
            {
                return AcquirePkcs11(RequirePin(pin));
            }
            catch (Exception ex)
            {
                pkcs11Error = ex;
            }
        }

        try
        {
            return AcquireCsp(pin ?? "");
        }
        catch (Exception cspEx)
        {
            var msg = "Auto signing failed for both PKCS#11 and CSP.";
            if (pkcs11Error is not null)
                msg += $" PKCS#11: {pkcs11Error.Message}.";
            msg += $" CSP: {cspEx.Message}";
            throw new InvalidOperationException(msg, cspEx);
        }
    }

    private TokenSigningContext AcquirePkcs11(string pin)
    {
        var lib = _settings.Pkcs11LibraryPath ?? Pkcs11KeyProvider.ProbeDefaultLibraryPath()
            ?? throw new InvalidOperationException(
                "PKCS#11 library not found. Set EINVOICE_PKCS11_LIBRARY to eps2003csp11.dll or SignatureP11.dll.");
        var provider = new Pkcs11KeyProvider(lib, _settings.CertificateSubjectFilter, _settings.CertificateThumbprint);
        return provider.Acquire(pin);
    }

    private TokenSigningContext AcquireCsp(string pin)
    {
        var provider = new CspKeyProvider(_settings.CertificateSubjectFilter, _settings.CertificateThumbprint);
        return provider.Acquire(pin);
    }

    private TokenSigningContext AcquireSoftware()
    {
        var (key, bcCert) = LoadSoftwareMaterial();
        var netCert = new X509Certificate2(bcCert.GetEncoded());
        return new TokenSigningContext
        {
            Certificate = netCert,
            SignatureFactory = null!,
            BcPrivateKey = key,
            BcCertificate = bcCert,
            Source = "SoftwarePEM",
        };
    }

    private (AsymmetricKeyParameter Key, BcX509 Cert) LoadSoftwareMaterial()
    {
        var keyPath = _settings.SoftwareKeyPemPath;
        var certPath = _settings.SoftwareCertPemPath;
        if (string.IsNullOrWhiteSpace(keyPath) || string.IsNullOrWhiteSpace(certPath))
        {
            var probed = ProbeSoftwareTestKeys();
            keyPath = probed.key;
            certPath = probed.cert;
        }

        if (!File.Exists(keyPath!) || !File.Exists(certPath!))
            throw new FileNotFoundException(
                $"Software key/cert PEM not found. Set EINVOICE_SOFTWARE_KEY_PEM / EINVOICE_SOFTWARE_CERT_PEM. Tried key={keyPath}");

        var key = CadesBesSigner.LoadPrivateKeyPem(File.ReadAllText(keyPath));
        var cert = CadesBesSigner.LoadCertificatePem(File.ReadAllText(certPath));
        return (key, cert);
    }

    private static (string key, string cert) ProbeSoftwareTestKeys()
    {
        foreach (var start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
        {
            var cur = new DirectoryInfo(start);
            while (cur != null)
            {
                var dir = Path.Combine(cur.FullName, "apps", "agent", "tests", "Einvoice.Agent.Tests", "TestKeys");
                var key = Path.Combine(dir, "software-test.key.pem");
                var cert = Path.Combine(dir, "software-test.cer.pem");
                if (File.Exists(key) && File.Exists(cert)) return (key, cert);
                cur = cur.Parent;
            }
        }

        return ("software-test.key.pem", "software-test.cer.pem");
    }

    private static string RequirePin(string? pin) =>
        string.IsNullOrEmpty(pin)
            ? throw new InvalidOperationException("PIN is required for hardware token signing.")
            : pin;
}
