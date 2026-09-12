using Einvoice.Agent.Config;
using Xunit;

namespace Einvoice.Agent.Tests;

public class PairingLifecycleTests
{
    [Fact]
    public void Drops_local_pairing_when_the_server_rejects_the_token()
    {
        Assert.True(PairingLifecycle.MustDropLocalPairing(tokenRejectedByServer: true, hasLocalDeviceToken: true));
    }

    [Fact]
    public void Keeps_local_pairing_while_the_token_is_still_accepted()
    {
        Assert.False(PairingLifecycle.MustDropLocalPairing(tokenRejectedByServer: false, hasLocalDeviceToken: true));
    }

    [Fact]
    public void Does_nothing_when_already_unpaired_locally()
    {
        Assert.False(PairingLifecycle.MustDropLocalPairing(tokenRejectedByServer: true, hasLocalDeviceToken: false));
    }

    [Fact]
    public void Skips_authenticated_calls_while_pairing_is_in_progress()
    {
        Assert.True(PairingLifecycle.ShouldSkipAuthenticatedCalls(pairingInProgress: true, hasUsableDeviceToken: true));
    }

    [Fact]
    public void Skips_authenticated_calls_without_a_usable_device_token()
    {
        Assert.True(PairingLifecycle.ShouldSkipAuthenticatedCalls(pairingInProgress: false, hasUsableDeviceToken: false));
    }

    [Fact]
    public void Allows_authenticated_calls_when_paired_and_idle()
    {
        Assert.False(PairingLifecycle.ShouldSkipAuthenticatedCalls(pairingInProgress: false, hasUsableDeviceToken: true));
    }
}
