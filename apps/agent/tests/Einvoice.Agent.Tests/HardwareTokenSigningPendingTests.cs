using Xunit;

namespace Einvoice.Agent.Tests;

/// <summary>
/// HARDWARE_SIGNING_PENDING — physical eSeal token not available yet.
/// These tests are permanently Skip'd so they never count as passed in CI.
/// When a token arrives, follow specs/006-desktop-signing-agent/HARDWARE-TEST.md,
/// remove Skip only after field confirmation, and set IsHardwarePathVerified=true.
/// </summary>
public class HardwareTokenSigningPendingTests
{
    public const string PendingReason =
        "HARDWARE_SIGNING_PENDING: physical eSeal token not available. " +
        "Do not remove Skip until HARDWARE-TEST.md passes on a real token " +
        "(pair → PIN → sign gv-01 → FR-011 CAdES checklist → ETA sandbox acceptance).";

    [Fact(Skip = PendingReason)]
    public void Pkcs11_Sign_gv01_meets_FR011_Cades_structural_checklist()
    {
        // Intended body (when token arrives):
        // 1. SIGNING_PROVIDER=pkcs11 + EINVOICE_PKCS11_LIBRARY + PIN
        // 2. Sign locked gv-01 digest input via Pkcs11TokenSigningProvider
        // 3. Assert FR-011 structural checklist (same as CadesSoftwareKeyGolden)
        // 4. Assert source label starts with PKCS#11: or CSP/CNG: (not SoftwarePEM)
        Assert.Fail("Unreachable while HARDWARE_SIGNING_PENDING.");
    }

    [Fact(Skip = PendingReason)]
    public void Pkcs11_signed_document_accepted_by_ETA_sandbox()
    {
        // Intended body (when token arrives):
        // 1. Pair device → Unlock PIN → agent signs READY doc
        // 2. Submit signed payload to ETA preprod/sandbox
        // 3. Assert ETA acceptance (definitive oracle)
        Assert.Fail("Unreachable while HARDWARE_SIGNING_PENDING.");
    }
}
