using Einvoice.Agent.Config;
using Einvoice.Agent.Security;
using Einvoice.Agent.Signing;
using Newtonsoft.Json.Linq;
using Xunit;

namespace Einvoice.Agent.Tests;

public class CredentialBoundaryTests
{
    [Fact]
    public void PinGuard_rejects_pin_field_in_cloud_payload()
    {
        var body = new JObject { ["documentId"] = "x", ["pin"] = "1234" };
        Assert.Throws<InvalidOperationException>(() => PinGuard.AssertNoPinInPayload(body));
    }

    [Fact]
    public void PinGuard_rejects_embedded_known_pin_in_string()
    {
        var body = new JObject { ["message"] = "login failed with 998877" };
        Assert.Throws<InvalidOperationException>(() =>
            PinGuard.AssertNoPinInPayload(body, knownPin: "998877"));
    }

    [Fact]
    public void PinGuard_allows_normal_submit_envelope()
    {
        var body = new JObject
        {
            ["documentId"] = Guid.NewGuid().ToString(),
            ["documentVersion"] = 1,
            ["signatureType"] = "I",
            ["cadesBase64"] = Convert.ToBase64String(new byte[] { 1, 2, 3 }),
            ["certificateThumbprint"] = "ABCDEF",
            ["signingSource"] = "PKCS#11:eps2003csp11.dll",
            ["signingProvider"] = "pkcs11",
            ["hardwareVerified"] = false,
        };
        PinGuard.AssertNoPinInPayload(body);
    }

    [Fact]
    public void PinGuard_redacts_pin_assignment_patterns()
    {
        var redacted = PinGuard.Redact("PKCS#11 login failed pin=123456 locked");
        Assert.DoesNotContain("123456", redacted);
        Assert.Contains("[REDACTED]", redacted);
    }

    [Fact]
    public void LocalAgentConfig_roundtrip_never_serializes_pin_property()
    {
        var path = Path.Combine(Path.GetTempPath(), $"agent-cfg-{Guid.NewGuid():N}.json");
        try
        {
            var cfg = new LocalAgentConfig
            {
                Pkcs11LibraryPath = @"C:\Windows\System32\eps2003csp11.dll",
                CertificateIssuerFilter = "Egypt Trust Sealing CA",
                CertificateThumbprint = "AABBCC",
                RememberPinEnabled = true,
                PinRememberMinutes = 15,
            };
            cfg.Save(path);
            var json = File.ReadAllText(path);
            Assert.DoesNotContain("\"pin\"", json, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("egypt trust sealing ca", json, StringComparison.OrdinalIgnoreCase);

            var loaded = LocalAgentConfig.Load(path);
            Assert.Equal(cfg.Pkcs11LibraryPath, loaded.Pkcs11LibraryPath);
            Assert.Equal(cfg.CertificateIssuerFilter, loaded.CertificateIssuerFilter);
            Assert.True(loaded.RememberPinEnabled);
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }

    [Fact]
    public void TokenAutoDetect_scan_does_not_throw_without_token()
    {
        var libs = TokenAutoDetect.ScanLibraries();
        Assert.NotNull(libs);
        var result = TokenAutoDetect.Detect();
        Assert.NotNull(result);
        Assert.NotNull(result.Libraries);
    }

    [Fact]
    public void PreferEsealCertificate_prefers_sealing_issuer()
    {
        var certs = new[]
        {
            new DetectedTokenCertificate("111", "CN=Other", "CN=Random CA", DateTime.UtcNow.AddYears(1)),
            new DetectedTokenCertificate(
                "222",
                "CN=Company eSeal",
                "CN=Egypt Trust Sealing CA",
                DateTime.UtcNow.AddYears(1)),
        };
        var pick = TokenAutoDetect.PreferEsealCertificate(certs);
        Assert.Equal("222", pick!.Thumbprint);
    }
}
