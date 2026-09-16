using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Net.Pkcs11Interop.Common;
using Net.Pkcs11Interop.HighLevelAPI;

namespace Einvoice.MacAgentPoc;

/// <summary>
/// Approach A — PKCS#11 .dylib via Pkcs11Interop (same library as the Windows agent).
/// Signs with CKM_SHA256_RSA_PKCS first (Windows path), then CKM_RSA_PKCS + DigestInfo fallback.
/// </summary>
internal static class Pkcs11Probe
{
    internal static readonly string[] WellKnownLibraryPaths =
    [
        "/usr/local/lib/libeps2003csp11.dylib",
        "/usr/lib/libeps2003csp11.dylib",
        "/usr/local/lib/pkcs11/libeps2003csp11.dylib",
        "/usr/local/lib/libcastle_v2.1.0.0.dylib",
        "/usr/local/lib/libcastle.dylib",
        "/Library/Frameworks/ePass2003Token.framework/Versions/Current/libeps2003csp11.dylib",
        "/usr/local/lib/opensc-pkcs11.dylib",
        "/Library/OpenSC/lib/opensc-pkcs11.dylib",
    ];

    public static ApproachResult Run(CliOptions options, string? pin)
    {
        Console.WriteLine("=== APPROACH A: PKCS#11 (Pkcs11Interop) ===");
        var result = new ApproachResult { Name = "PKCS#11" };

        var libraryPath = ResolveLibraryPath(options.Pkcs11Lib);
        if (libraryPath is null)
        {
            result.FailureReason =
                "No PKCS#11 .dylib found. Pass --pkcs11-lib /path/to/libeps2003csp11.dylib " +
                "(typical: /usr/local/lib/libeps2003csp11.dylib after Feitian/ePass middleware).";
            Console.WriteLine("Library loaded: NO");
            Console.WriteLine(result.FailureReason);
            Console.WriteLine();
            return result;
        }

        Console.WriteLine("Library path:   {0}", libraryPath);
        Console.WriteLine("File exists:    {0}", File.Exists(libraryPath) ? "YES" : "NO");

        if (!File.Exists(libraryPath))
        {
            result.FailureReason = $"File not found: {libraryPath}";
            Console.WriteLine("Library loaded: NO");
            Console.WriteLine();
            return result;
        }

        var factories = new Pkcs11InteropFactories();
        IPkcs11Library? pkcs11 = null;
        try
        {
            pkcs11 = factories.Pkcs11LibraryFactory.LoadPkcs11Library(
                factories,
                libraryPath,
                AppType.MultiThreaded);
        }
        catch (Exception ex)
        {
            result.FailureReason =
                $"Failed to load PKCS#11 library: {ex.Message}. " +
                "If this is arm64 .NET with an Intel-only .dylib, publish/run osx-x64 under Rosetta, " +
                "or install a universal/arm64 middleware package. Check with: file \"" + libraryPath + "\"";
            Console.WriteLine("Library loaded: NO");
            Console.WriteLine("  error: {0}", ex.GetType().Name);
            Console.WriteLine("  {0}", ex.Message);
            Console.WriteLine();
            return result;
        }

        if (pkcs11 is null)
        {
            result.FailureReason = "PKCS#11 factory returned null.";
            Console.WriteLine("Library loaded: NO");
            Console.WriteLine();
            return result;
        }

        try
        {
            result.LibraryOrStoreLoaded = true;
            var info = pkcs11.GetInfo();
            Console.WriteLine("Library loaded: YES");
            Console.WriteLine("  manufacturer: {0}", info.ManufacturerId?.Trim());
            Console.WriteLine("  description:  {0}", info.LibraryDescription?.Trim());
            Console.WriteLine("  cryptoki:     {0}", info.CryptokiVersion);
            Console.WriteLine("  version:      {0}", info.LibraryVersion);

            ListSlots(pkcs11);

            var slots = pkcs11.GetSlotList(SlotsType.WithTokenPresent);
            if (slots.Count == 0)
            {
                result.FailureReason = "Library loaded but no token present. Insert the eSeal USB token.";
                Console.WriteLine("Token present:  NO");
                Console.WriteLine(result.FailureReason);
                Console.WriteLine();
                return result;
            }

            foreach (var slot in slots)
            {
                TrySlot(slot, options, ref pin, result);
                if (result.Succeeded)
                    break;
            }

            if (!result.CertificateFound && string.IsNullOrWhiteSpace(result.FailureReason))
            {
                result.FailureReason = string.IsNullOrWhiteSpace(options.Subject) && string.IsNullOrWhiteSpace(options.Issuer)
                    ? "No X.509 certificates on the token."
                    : "No certificate matched --subject / --issuer.";
            }
        }
        catch (Exception ex)
        {
            result.FailureReason ??= $"PKCS#11 probe failed: {DescribePkcs11(ex)}";
            Console.WriteLine("ERROR: {0}", result.FailureReason);
        }
        finally
        {
            pkcs11?.Dispose();
        }

        Console.WriteLine();
        Console.WriteLine(
            "Approach A result: loaded={0} cert={1} privkey={2} signed={3} verified={4} => {5}",
            Program.Yn(result.LibraryOrStoreLoaded),
            Program.Yn(result.CertificateFound),
            Program.Yn(result.PrivateKeyUsable),
            Program.Yn(result.SignatureProduced),
            Program.Yn(result.SignatureVerified),
            result.Succeeded ? "PASS" : "FAIL");
        Console.WriteLine();
        return result;
    }

    internal static string? ResolveLibraryPath(string? explicitPath)
    {
        if (!string.IsNullOrWhiteSpace(explicitPath))
            return explicitPath;

        Console.WriteLine("--pkcs11-lib not set; probing well-known macOS paths:");
        foreach (var candidate in WellKnownLibraryPaths)
        {
            var exists = File.Exists(candidate);
            Console.WriteLine("  {0}  {1}", exists ? "FOUND" : "miss ", candidate);
            if (exists)
                return candidate;
        }

        return null;
    }

    private static void ListSlots(IPkcs11Library pkcs11)
    {
        Console.WriteLine("Slots:");
        var all = pkcs11.GetSlotList(SlotsType.WithOrWithoutTokenPresent);
        if (all.Count == 0)
        {
            Console.WriteLine("  (none)");
            return;
        }

        foreach (var slot in all)
        {
            var slotInfo = slot.GetSlotInfo();
            var present = slotInfo.SlotFlags.TokenPresent;
            Console.WriteLine(
                "  slot {0}: {1}  tokenPresent={2}",
                slot.SlotId,
                slotInfo.SlotDescription?.Trim(),
                Program.Yn(present));
            if (!present)
                continue;

            try
            {
                var token = slot.GetTokenInfo();
                Console.WriteLine("           label={0}", token.Label?.Trim());
                Console.WriteLine("           manufacturer={0}  model={1}  serial={2}",
                    token.ManufacturerId?.Trim(),
                    token.Model?.Trim(),
                    token.SerialNumber?.Trim());
            }
            catch (Exception ex)
            {
                Console.WriteLine("           (token info failed: {0})", ex.Message);
            }

            try
            {
                var mechs = slot.GetMechanismList();
                var sha256Rsa = mechs.Contains(CKM.CKM_SHA256_RSA_PKCS);
                var rsaPkcs = mechs.Contains(CKM.CKM_RSA_PKCS);
                Console.WriteLine(
                    "           CKM_SHA256_RSA_PKCS={0}  CKM_RSA_PKCS={1}  (Windows agent uses SHA256_RSA_PKCS)",
                    Program.Yn(sha256Rsa),
                    Program.Yn(rsaPkcs));
            }
            catch (Exception ex)
            {
                Console.WriteLine("           (mechanism list failed: {0})", ex.Message);
            }
        }
    }

    private static void TrySlot(ISlot slot, CliOptions options, ref string? pin, ApproachResult result)
    {
        using var session = slot.OpenSession(SessionType.ReadWrite);
        Console.WriteLine();
        Console.WriteLine("Certificates on slot {0} (public objects, before PIN):", slot.SlotId);

        var certs = ReadCertificates(session);
        if (certs.Count == 0)
        {
            Console.WriteLine("  (none)");
        }
        else
        {
            foreach (var c in certs)
            {
                var match = Program.MatchesFilter(c.Cert, options);
                Console.WriteLine("  [{0}] {1}", match ? "match" : "skip ", Program.FormatCert(c.Cert));
                Console.WriteLine("         CKA_ID={0}", Program.Hex(c.CkaId));
            }
        }

        var candidates = certs.Where(c => Program.MatchesFilter(c.Cert, options)).ToList();
        if (candidates.Count == 0)
            return;

        result.CertificateFound = true;
        var preferred = candidates
            .OrderByDescending(c => Program.EsealScore(c.Cert))
            .First();
        result.CertificateSubject = preferred.Cert.Subject;

        if (string.IsNullOrEmpty(pin))
        {
            pin = Program.PromptPin("PKCS#11 token PIN (hidden): ");
        }

        if (string.IsNullOrEmpty(pin))
        {
            result.FailureReason = "PIN is required to use the private key (empty PIN).";
            Console.WriteLine("PIN login:      NO (empty PIN)");
            return;
        }

        try
        {
            session.Login(CKU.CKU_USER, pin);
            Console.WriteLine("PIN login:      YES");
        }
        catch (Exception ex)
        {
            result.FailureReason = $"PKCS#11 login failed (wrong PIN or locked token): {DescribePkcs11(ex)}";
            Console.WriteLine("PIN login:      NO");
            Console.WriteLine("  {0}", result.FailureReason);
            return;
        }

        try
        {
            foreach (var candidate in candidates.OrderByDescending(c => Program.EsealScore(c.Cert)))
            {
                if (TrySignWithCert(session, candidate, result))
                    return;
            }

            if (!result.PrivateKeyUsable)
            {
                result.FailureReason =
                    "Certificates found but no matching RSA private-key object after login. " +
                    "The token may not expose CKO_PRIVATE_KEY, or CKA_ID does not pair with the cert.";
                Console.WriteLine("Private key:    NO matching CKO_PRIVATE_KEY");
            }
        }
        finally
        {
            try { session.Logout(); } catch { /* ignore */ }
        }
    }

    private static bool TrySignWithCert(ISession session, TokenCert candidate, ApproachResult result)
    {
        var key = FindPrivateKey(session, candidate.CkaId);
        Console.WriteLine();
        Console.WriteLine("Selected cert:  {0}", candidate.Cert.Subject);
        if (key is null)
        {
            Console.WriteLine("Private key:    NO (no RSA CKO_PRIVATE_KEY for this CKA_ID, and no sign-capable fallback)");
            return false;
        }

        result.PrivateKeyUsable = true;
        result.CertificateFound = true;
        result.CertificateSubject = candidate.Cert.Subject;
        Console.WriteLine("Private key:    YES  (handle present, CKA_ID={0})", Program.Hex(candidate.CkaId));

        byte[]? signature = null;
        string? mechanismUsed = null;

        try
        {
            using var mech = session.Factories.MechanismFactory.Create(CKM.CKM_SHA256_RSA_PKCS);
            signature = session.Sign(mech, key, Program.SamplePayload);
            mechanismUsed = "CKM_SHA256_RSA_PKCS";
        }
        catch (Exception ex)
        {
            Console.WriteLine("CKM_SHA256_RSA_PKCS failed: {0}", DescribePkcs11(ex));
            try
            {
                var digestInfo = Sha256DigestInfo(Program.SamplePayload);
                using var mech = session.Factories.MechanismFactory.Create(CKM.CKM_RSA_PKCS);
                signature = session.Sign(mech, key, digestInfo);
                mechanismUsed = "CKM_RSA_PKCS + SHA256 DigestInfo (fallback)";
            }
            catch (Exception ex2)
            {
                result.FailureReason =
                    $"Private key found but Sign failed. SHA256_RSA_PKCS: {DescribePkcs11(ex)}; " +
                    $"RSA_PKCS fallback: {DescribePkcs11(ex2)}";
                Console.WriteLine("Signature:      NO");
                Console.WriteLine("  {0}", result.FailureReason);
                return false;
            }
        }

        result.SignatureProduced = signature is { Length: > 0 };
        Console.WriteLine("Signature:      {0}  ({1} bytes, {2})",
            Program.Yn(result.SignatureProduced),
            signature?.Length ?? 0,
            mechanismUsed);

        var verified = result.SignatureProduced &&
                       Program.VerifyRsaSha256Pkcs1(candidate.Cert, Program.SamplePayload, signature!);
        result.SignatureVerified = verified;
        Console.WriteLine("Verified:       {0}  (RSA-SHA256 PKCS#1 vs certificate public key)", Program.Yn(verified));

        if (!verified)
            result.FailureReason = "Signature produced but did not verify against the certificate public key.";

        return result.Succeeded;
    }

    private static IObjectHandle? FindPrivateKey(ISession session, byte[]? ckaId)
    {
        if (ckaId is { Length: > 0 })
        {
            var byId = session.FindAllObjects(
            [
                session.Factories.ObjectAttributeFactory.Create(CKA.CKA_CLASS, CKO.CKO_PRIVATE_KEY),
                session.Factories.ObjectAttributeFactory.Create(CKA.CKA_KEY_TYPE, CKK.CKK_RSA),
                session.Factories.ObjectAttributeFactory.Create(CKA.CKA_ID, ckaId),
            ]);
            if (byId.Count > 0)
                return byId[0];
        }

        var any = session.FindAllObjects(
        [
            session.Factories.ObjectAttributeFactory.Create(CKA.CKA_CLASS, CKO.CKO_PRIVATE_KEY),
            session.Factories.ObjectAttributeFactory.Create(CKA.CKA_KEY_TYPE, CKK.CKK_RSA),
            session.Factories.ObjectAttributeFactory.Create(CKA.CKA_SIGN, true),
        ]);
        return any.Count > 0 ? any[0] : null;
    }

    private static List<TokenCert> ReadCertificates(ISession session)
    {
        var list = new List<TokenCert>();
        var handles = session.FindAllObjects(
        [
            session.Factories.ObjectAttributeFactory.Create(CKA.CKA_CLASS, CKO.CKO_CERTIFICATE),
            session.Factories.ObjectAttributeFactory.Create(CKA.CKA_CERTIFICATE_TYPE, CKC.CKC_X_509),
            session.Factories.ObjectAttributeFactory.Create(CKA.CKA_TOKEN, true),
        ]);

        foreach (var handle in handles)
        {
            try
            {
                var attrs = session.GetAttributeValue(handle, [CKA.CKA_VALUE, CKA.CKA_ID]);
                var der = attrs[0].GetValueAsByteArray();
                var id = attrs[1].GetValueAsByteArray();
                list.Add(new TokenCert(new X509Certificate2(der), id ?? []));
            }
            catch (Exception ex)
            {
                Console.WriteLine("  (failed to read a cert object: {0})", ex.Message);
            }
        }

        return list;
    }

    private static byte[] Sha256DigestInfo(byte[] message)
    {
        var hash = SHA256.HashData(message);
        byte[] prefix =
        [
            0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86,
            0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05,
            0x00, 0x04, 0x20,
        ];
        var info = new byte[prefix.Length + hash.Length];
        prefix.CopyTo(info, 0);
        hash.CopyTo(info, prefix.Length);
        return info;
    }

    private static string DescribePkcs11(Exception ex)
    {
        if (ex is Pkcs11Exception pkcs)
            return $"CKR={pkcs.RV} {pkcs.Message}";
        return ex.Message;
    }

    private sealed record TokenCert(X509Certificate2 Cert, byte[] CkaId);
}
