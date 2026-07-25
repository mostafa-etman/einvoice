using System.Security.Cryptography.X509Certificates;
using Einvoice.Agent.Config;
using Org.BouncyCastle.Crypto;
using BcX509 = Org.BouncyCastle.X509.X509Certificate;

namespace Einvoice.Agent.Signing;

/// <summary>
/// Dev + CI signing provider using the committed software RSA test key.
/// This is the only provider exercised end-to-end until a physical token is available.
/// </summary>
public sealed class SoftwareKeySigningProvider : ISigningProvider
{
    private readonly AgentSettings _settings;

    public SoftwareKeySigningProvider(AgentSettings settings) => _settings = settings;

    public string ProviderId => SigningProviderKind.Software.ToConfigValue();
    public string DisplayName => "SoftwareKey (committed test RSA)";
    public bool RequiresPin => false;
    public bool IsHardwarePathVerified => true; // software path is the verified CI/dev gate

    public SigningOutcome Sign(byte[] contentUtf8, string? pin)
    {
        _ = pin; // software ignores PIN
        var (key, bcCert) = LoadSoftwareMaterial();
        var der = CadesBesSigner.SignDetached(contentUtf8, key, bcCert);
        var netCert = new X509Certificate2(bcCert.GetEncoded());
        return new SigningOutcome
        {
            CadesDer = der,
            Certificate = netCert,
            SourceLabel = "SoftwarePEM",
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

    public static (string key, string cert) ProbeSoftwareTestKeys()
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

                var near = Path.Combine(cur.FullName, "TestKeys");
                key = Path.Combine(near, "software-test.key.pem");
                cert = Path.Combine(near, "software-test.cer.pem");
                if (File.Exists(key) && File.Exists(cert)) return (key, cert);

                cur = cur.Parent;
            }
        }

        return ("software-test.key.pem", "software-test.cer.pem");
    }
}
