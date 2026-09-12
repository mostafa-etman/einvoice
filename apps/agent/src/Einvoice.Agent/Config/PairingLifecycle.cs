namespace Einvoice.Agent.Config;

/// <summary>
/// Local pairing must track cloud revoke. After admin/web unpair the next
/// agent call is 401 — drop the saved token so Pair is available again.
/// Authenticated polling must not run while a Pair request is in flight.
/// </summary>
public static class PairingLifecycle
{
    public static bool MustDropLocalPairing(bool tokenRejectedByServer, bool hasLocalDeviceToken) =>
        tokenRejectedByServer && hasLocalDeviceToken;

    public static bool ShouldSkipAuthenticatedCalls(bool pairingInProgress, bool hasUsableDeviceToken) =>
        pairingInProgress || !hasUsableDeviceToken;
}
