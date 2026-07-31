using System.Security.Cryptography.X509Certificates;
using Net.Pkcs11Interop.Common;
using Net.Pkcs11Interop.HighLevelAPI;

namespace Einvoice.Agent.Signing;

public sealed record DetectedPkcs11Library(string Path, string FileName);

public sealed record DetectedTokenCertificate(
    string Thumbprint,
    string Subject,
    string Issuer,
    DateTime NotAfter);

public sealed record TokenDetectionResult(
    IReadOnlyList<DetectedPkcs11Library> Libraries,
    string? PreferredLibraryPath,
    IReadOnlyList<DetectedTokenCertificate> Certificates,
    string? Notes);

/// <summary>
/// Auto-detect PKCS#11 middleware and (when the token is present) public certificates.
/// No PIN is required to list public cert objects; PIN is only used at Sign time.
/// </summary>
public static class TokenAutoDetect
{
    public static readonly string[] KnownLibraryFileNames =
    [
        "eps2003csp11.dll",
        "SignatureP11.dll",
        "ngp11v211.dll",
        "cryptoVisionPKCS11.dll",
    ];

    public static IReadOnlyList<DetectedPkcs11Library> ScanLibraries()
    {
        var found = new List<DetectedPkcs11Library>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var candidate in CandidatePaths())
        {
            if (string.IsNullOrWhiteSpace(candidate) || !File.Exists(candidate))
                continue;
            var full = Path.GetFullPath(candidate);
            if (!seen.Add(full))
                continue;
            found.Add(new DetectedPkcs11Library(full, Path.GetFileName(full)));
        }

        return found;
    }

    public static TokenDetectionResult Detect(string? preferredLibrary = null)
    {
        var libs = ScanLibraries();
        var preferred = preferredLibrary;
        if (string.IsNullOrWhiteSpace(preferred) || !File.Exists(preferred))
            preferred = libs.FirstOrDefault()?.Path;

        var certs = new List<DetectedTokenCertificate>();
        string? notes = null;

        if (!string.IsNullOrWhiteSpace(preferred))
        {
            try
            {
                certs.AddRange(EnumeratePublicCertificates(preferred));
                if (certs.Count == 0)
                    notes = "PKCS#11 library found but no public certificates (insert token?).";
            }
            catch (Exception ex)
            {
                notes = $"Could not read token certificates: {ex.Message}";
            }
        }
        else
        {
            notes = "No known PKCS#11 library found. Install token middleware or pick the DLL manually.";
        }

        return new TokenDetectionResult(libs, preferred, certs, notes);
    }

    /// <summary>
    /// List X.509 certs as public token objects without PIN login.
    /// </summary>
    public static IReadOnlyList<DetectedTokenCertificate> EnumeratePublicCertificates(string libraryPath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(libraryPath);
        var results = new List<DetectedTokenCertificate>();

        var factories = new Pkcs11InteropFactories();
        using var pkcs11 = factories.Pkcs11LibraryFactory.LoadPkcs11Library(
            factories,
            libraryPath,
            AppType.MultiThreaded);

        foreach (var slot in pkcs11.GetSlotList(SlotsType.WithTokenPresent))
        {
            using var session = slot.OpenSession(SessionType.ReadOnly);
            var certTemplate = new List<IObjectAttribute>
            {
                session.Factories.ObjectAttributeFactory.Create(CKA.CKA_CLASS, CKO.CKO_CERTIFICATE),
                session.Factories.ObjectAttributeFactory.Create(CKA.CKA_CERTIFICATE_TYPE, CKC.CKC_X_509),
                session.Factories.ObjectAttributeFactory.Create(CKA.CKA_TOKEN, true),
            };

            foreach (var handle in session.FindAllObjects(certTemplate))
            {
                var attrs = session.GetAttributeValue(handle, new List<CKA> { CKA.CKA_VALUE });
                var der = attrs[0].GetValueAsByteArray();
                using var cert = new X509Certificate2(der);
                results.Add(new DetectedTokenCertificate(
                    cert.Thumbprint ?? "",
                    cert.Subject,
                    cert.Issuer,
                    cert.NotAfter));
            }
        }

        return results;
    }

    /// <summary>Pick a likely eSeal cert (Egypt Trust / Sealing CA heuristics).</summary>
    public static DetectedTokenCertificate? PreferEsealCertificate(
        IReadOnlyList<DetectedTokenCertificate> certs)
    {
        if (certs.Count == 0) return null;
        if (certs.Count == 1) return certs[0];

        static int Score(DetectedTokenCertificate c)
        {
            var hay = $"{c.Subject} {c.Issuer}";
            var score = 0;
            if (hay.Contains("Egypt Trust", StringComparison.OrdinalIgnoreCase)) score += 10;
            if (hay.Contains("Sealing", StringComparison.OrdinalIgnoreCase)) score += 20;
            if (hay.Contains("eSeal", StringComparison.OrdinalIgnoreCase)) score += 15;
            if (hay.Contains("CA G6", StringComparison.OrdinalIgnoreCase)) score += 5;
            return score;
        }

        return certs.OrderByDescending(Score).First();
    }

    private static IEnumerable<string> CandidatePaths()
    {
        var env = Environment.GetEnvironmentVariable("EINVOICE_PKCS11_LIBRARY");
        if (!string.IsNullOrWhiteSpace(env))
            yield return env;

        var system = Environment.SystemDirectory;
        var sysWow = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            "SysWOW64");
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);

        foreach (var name in KnownLibraryFileNames)
        {
            yield return Path.Combine(system, name);
            yield return Path.Combine(sysWow, name);
            yield return Path.Combine(@"C:\Windows\System32", name);
            yield return Path.Combine(programFiles, "Egypt Trust", name);
            yield return Path.Combine(programFilesX86, "Egypt Trust", name);
            yield return Path.Combine(programFiles, "ePass2003", name);
            yield return Path.Combine(programFilesX86, "ePass2003", name);
        }
    }
}
