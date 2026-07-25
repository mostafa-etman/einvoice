using System.Text;
using Einvoice.Agent.Config;
using Einvoice.Agent.Signing;
using Xunit;

namespace Einvoice.Agent.Tests;

public class SigningProviderTests
{
    [Fact]
    public void Factory_defaults_to_software_provider()
    {
        var settings = AgentSettings.FromEnvironment(new Dictionary<string, string?>());
        Assert.Equal(SigningProviderKind.Software, settings.SigningProvider);

        var provider = SigningProviderFactory.Create(settings);
        Assert.Equal("software", provider.ProviderId);
        Assert.False(provider.RequiresPin);
        Assert.True(provider.IsHardwarePathVerified);
    }

    [Theory]
    [InlineData("software", SigningProviderKind.Software)]
    [InlineData("SOFTWARE", SigningProviderKind.Software)]
    [InlineData("pkcs11", SigningProviderKind.Pkcs11)]
    [InlineData("token", SigningProviderKind.Pkcs11)]
    [InlineData("Auto", SigningProviderKind.Pkcs11)] // legacy → hardware provider
    public void Config_parses_SIGNING_PROVIDER(string raw, SigningProviderKind expected)
    {
        var settings = AgentSettings.FromEnvironment(new Dictionary<string, string?>
        {
            ["SIGNING_PROVIDER"] = raw,
        });
        Assert.Equal(expected, settings.SigningProvider);
    }

    [Fact]
    public void Software_provider_signs_end_to_end_via_SignPipeline()
    {
        var settings = new AgentSettings { SigningProvider = SigningProviderKind.Software };
        var provider = SigningProviderFactory.Create(settings);

        var result = SignPipeline.SignDocumentJson("""{"internalID":"sw-1","totalAmount":1}""", provider, pin: null);

        Assert.Equal(SignPipeline.IssuerSignatureType, result.SignatureType);
        Assert.False(string.IsNullOrWhiteSpace(result.CadesBase64));
        Assert.Equal("SoftwarePEM", result.SourceLabel);
        Assert.Contains("INTERNALID", result.Canonical, StringComparison.Ordinal);
        Assert.DoesNotContain("signatures", result.Canonical, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Pkcs11_provider_is_marked_unverified_and_probes_without_token()
    {
        var settings = new AgentSettings { SigningProvider = SigningProviderKind.Pkcs11 };
        var provider = Assert.IsType<Pkcs11TokenSigningProvider>(SigningProviderFactory.Create(settings));

        Assert.Equal("pkcs11", provider.ProviderId);
        Assert.True(provider.RequiresPin);
        Assert.False(provider.IsHardwarePathVerified);
        Assert.Contains(Pkcs11TokenSigningProvider.HardwarePendingMarker, provider.DisplayName);

        var report = provider.ProbeReadiness();
        Assert.Equal(Pkcs11TokenSigningProvider.HardwarePendingMarker, report.Marker);
        Assert.False(report.Verified);
        Assert.Contains("UNVERIFIED", report.Notes);
    }

    [Fact]
    public void Pkcs11_Sign_without_pin_fails_fast_with_pending_marker()
    {
        var provider = new Pkcs11TokenSigningProvider(new AgentSettings());
        var ex = Assert.Throws<InvalidOperationException>(() =>
            provider.Sign(Encoding.UTF8.GetBytes("\"x\"\"1\""), pin: null));
        Assert.Contains(Pkcs11TokenSigningProvider.HardwarePendingMarker, ex.Message);
    }
}
