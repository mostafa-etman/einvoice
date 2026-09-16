using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;

namespace Einvoice.MacAgentPoc;

/// <summary>
/// Standalone macOS diagnostic: can this machine SIGN with the eSeal token private key?
/// Does not build CAdES / ESS signing-certificate-v2 — that stays on the Windows agent path.
/// </summary>
internal static class Program
{
    internal static readonly byte[] SamplePayload =
        Encoding.UTF8.GetBytes("einvoice-mac-agent-poc-v1|RSA-SHA256|fixed-sample");

    private static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;

        if (args.Any(a => a is "-h" or "--help" or "/?"))
        {
            PrintHelp();
            return 0;
        }

        CliOptions options;
        try
        {
            options = CliOptions.Parse(args);
        }
        catch (ArgumentException ex)
        {
            Console.Error.WriteLine(ex.Message);
            Console.Error.WriteLine("Use --help for usage.");
            return 1;
        }
        PrintRuntimeBanner();

        Console.WriteLine("Sample payload: {0} bytes (UTF-8)", SamplePayload.Length);
        Console.WriteLine("Mechanism under test: RSA + SHA-256 + PKCS#1 v1.5 (CKM_SHA256_RSA_PKCS / equivalent).");
        Console.WriteLine("This is NOT a CAdES-BES / ESS signing-certificate-v2 test.");
        Console.WriteLine();

        string? pin = options.Pin;
        ApproachResult pkcs11;
        ApproachResult keychain;

        try
        {
            if (options.SkipPkcs11)
            {
                pkcs11 = ApproachResult.CreateSkipped("PKCS#11", "skipped by --skip-pkcs11");
                Console.WriteLine("=== APPROACH A: PKCS#11 ===");
                Console.WriteLine("SKIPPED (--skip-pkcs11)");
                Console.WriteLine();
            }
            else
            {
                pkcs11 = Pkcs11Probe.Run(options, pin);
            }

            if (options.SkipKeychain)
            {
                keychain = ApproachResult.CreateSkipped("Keychain", "skipped by --skip-keychain");
                Console.WriteLine("=== APPROACH B: macOS Keychain ===");
                Console.WriteLine("SKIPPED (--skip-keychain)");
                Console.WriteLine();
            }
            else
            {
                keychain = KeychainProbe.Run(options);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Unhandled error: {0}", ex);
            return 1;
        }

        PrintSummary(pkcs11, keychain);
        return pkcs11.Succeeded || keychain.Succeeded ? 0 : 2;
    }

    private static void PrintRuntimeBanner()
    {
        Console.WriteLine("=== eInvoice macOS eSeal signing POC ===");
        Console.WriteLine("OS:              {0}", RuntimeInformation.OSDescription.Trim());
        Console.WriteLine("OS architecture: {0}", RuntimeInformation.OSArchitecture);
        Console.WriteLine("Process arch:    {0}", RuntimeInformation.ProcessArchitecture);
        Console.WriteLine("RID:             {0}", RuntimeInformation.RuntimeIdentifier);
        Console.WriteLine(".NET runtime:    {0}", RuntimeInformation.FrameworkDescription);
        Console.WriteLine("64-bit process:  {0}", Environment.Is64BitProcess);
        Console.WriteLine();
    }

    private static void PrintSummary(ApproachResult pkcs11, ApproachResult keychain)
    {
        Console.WriteLine("=== SUMMARY ===");
        PrintApproachLine(pkcs11);
        PrintApproachLine(keychain);

        var winners = new List<string>();
        if (pkcs11.Succeeded) winners.Add("PKCS#11");
        if (keychain.Succeeded) winners.Add("Keychain");

        Console.WriteLine();
        if (winners.Count == 0)
        {
            Console.WriteLine(
                "FINAL: neither approach SUCCEEDED in producing a verifiable signature.");
        }
        else
        {
            Console.WriteLine(
                "FINAL: approach(es) that SUCCEEDED in producing a verifiable signature: {0}",
                string.Join(", ", winners));
        }
    }

    private static void PrintApproachLine(ApproachResult r)
    {
        Console.WriteLine(
            "  {0,-10} loaded={1,-3}  cert={2,-3}  privkey={3,-3}  signed={4,-3}  verified={5,-3}  => {6}",
            r.Name,
            Yn(r.LibraryOrStoreLoaded),
            Yn(r.CertificateFound),
            Yn(r.PrivateKeyUsable),
            Yn(r.SignatureProduced),
            Yn(r.SignatureVerified),
            r.Succeeded ? "SUCCEEDED" : r.IsSkipped ? "SKIPPED" : "FAILED");
        if (!string.IsNullOrWhiteSpace(r.CertificateSubject))
            Console.WriteLine("             subject: {0}", r.CertificateSubject);
        if (!string.IsNullOrWhiteSpace(r.FailureReason) && !r.Succeeded)
            Console.WriteLine("             reason:  {0}", r.FailureReason);
    }

    internal static string Yn(bool v) => v ? "YES" : "NO";

    internal static bool MatchesFilter(X509Certificate2 cert, CliOptions options)
    {
        if (!string.IsNullOrWhiteSpace(options.Issuer) &&
            cert.Issuer.IndexOf(options.Issuer, StringComparison.OrdinalIgnoreCase) < 0)
        {
            return false;
        }

        if (string.IsNullOrWhiteSpace(options.Subject))
            return true;

        var hay = $"{cert.Subject} {cert.Issuer}";
        return hay.IndexOf(options.Subject, StringComparison.OrdinalIgnoreCase) >= 0;
    }

    internal static int EsealScore(X509Certificate2 cert)
    {
        var hay = $"{cert.Subject} {cert.Issuer}";
        var score = 0;
        if (hay.Contains("Egypt Trust", StringComparison.OrdinalIgnoreCase)) score += 10;
        if (hay.Contains("Sealing", StringComparison.OrdinalIgnoreCase)) score += 20;
        if (hay.Contains("eSeal", StringComparison.OrdinalIgnoreCase)) score += 15;
        if (hay.Contains("CA G6", StringComparison.OrdinalIgnoreCase)) score += 5;
        return score;
    }

    internal static bool VerifyRsaSha256Pkcs1(X509Certificate2 cert, byte[] data, byte[] signature)
    {
        using var rsa = cert.GetRSAPublicKey();
        if (rsa is null)
            return false;
        return rsa.VerifyData(data, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
    }

    internal static string FormatCert(X509Certificate2 cert)
    {
        return string.Format(
            CultureInfo.InvariantCulture,
            "subject={0}{1}         issuer={2}{1}         serial={3}{1}         thumbprint={4}{1}         notAfter={5:yyyy-MM-dd}",
            cert.Subject,
            Environment.NewLine,
            cert.Issuer,
            cert.SerialNumber,
            cert.Thumbprint,
            cert.NotAfter);
    }

    internal static string Hex(byte[]? data, int max = 32)
    {
        if (data is null || data.Length == 0)
            return "(empty)";
        var take = Math.Min(data.Length, max);
        var hex = Convert.ToHexString(data.AsSpan(0, take));
        return data.Length > max ? hex + "…" : hex;
    }

    internal static string PromptPin(string prompt)
    {
        Console.Write(prompt);
        if (Console.IsInputRedirected)
            return (Console.ReadLine() ?? string.Empty).TrimEnd('\r', '\n');

        var sb = new StringBuilder();
        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter)
            {
                Console.WriteLine();
                break;
            }

            if (key.Key == ConsoleKey.Backspace)
            {
                if (sb.Length > 0)
                    sb.Length--;
                continue;
            }

            if (!char.IsControl(key.KeyChar))
                sb.Append(key.KeyChar);
        }

        return sb.ToString();
    }

    private static void PrintHelp()
    {
        Console.WriteLine(
            """
            Einvoice.MacAgentPoc — macOS eSeal signing diagnostic (PKCS#11 + Keychain)

            Tries BOTH approaches and reports which can produce a verifiable RSA-SHA256 signature
            with the token's PRIVATE KEY. Does not produce ETA CAdES-BES.

            Usage:
              Einvoice.MacAgentPoc [--pkcs11-lib PATH] [--subject FILTER] [--issuer FILTER]
                                   [--pin PIN] [--skip-pkcs11] [--skip-keychain]

            Options:
              --pkcs11-lib PATH   PKCS#11 .dylib (Feitian/ePass). If omitted, well-known paths are probed.
              --subject FILTER    Substring matched against certificate subject (and issuer).
              --issuer FILTER     Substring matched against certificate issuer only.
              --pin PIN           Token PIN for PKCS#11 (omit to be prompted; do not use on shared shells).
              --skip-pkcs11       Skip Approach A.
              --skip-keychain     Skip Approach B.

            Examples (run on the Mac after publish):
              ./Einvoice.MacAgentPoc --pkcs11-lib /usr/local/lib/libeps2003csp11.dylib --subject "Egypt Trust"
              ./Einvoice.MacAgentPoc --pkcs11-lib /usr/local/lib/libcastle_v2.1.0.0.dylib --subject "eSeal"
            """);
    }
}

internal sealed class CliOptions
{
    public string? Pkcs11Lib { get; init; }
    public string? Subject { get; init; }
    public string? Issuer { get; init; }
    public string? Pin { get; init; }
    public bool SkipPkcs11 { get; init; }
    public bool SkipKeychain { get; init; }

    public static CliOptions Parse(string[] args)
    {
        string? pkcs11 = null, subject = null, issuer = null, pin = null;
        var skipPkcs11 = false;
        var skipKeychain = false;

        for (var i = 0; i < args.Length; i++)
        {
            var a = args[i];
            switch (a)
            {
                case "--pkcs11-lib":
                    pkcs11 = Next(args, ref i, a);
                    break;
                case "--subject":
                    subject = Next(args, ref i, a);
                    break;
                case "--issuer":
                    issuer = Next(args, ref i, a);
                    break;
                case "--pin":
                    pin = Next(args, ref i, a);
                    break;
                case "--skip-pkcs11":
                    skipPkcs11 = true;
                    break;
                case "--skip-keychain":
                    skipKeychain = true;
                    break;
                default:
                    throw new ArgumentException($"Unknown argument '{a}'. Use --help.");
            }
        }

        return new CliOptions
        {
            Pkcs11Lib = pkcs11,
            Subject = subject,
            Issuer = issuer,
            Pin = pin,
            SkipPkcs11 = skipPkcs11,
            SkipKeychain = skipKeychain,
        };
    }

    private static string Next(string[] args, ref int i, string flag)
    {
        if (i + 1 >= args.Length)
            throw new ArgumentException($"{flag} requires a value.");
        return args[++i];
    }
}

internal sealed class ApproachResult
{
    public required string Name { get; init; }
    public bool IsSkipped { get; init; }
    public bool LibraryOrStoreLoaded { get; set; }
    public bool CertificateFound { get; set; }
    public string? CertificateSubject { get; set; }
    public bool PrivateKeyUsable { get; set; }
    public bool SignatureProduced { get; set; }
    public bool SignatureVerified { get; set; }
    public string? FailureReason { get; set; }

    public bool Succeeded => SignatureProduced && SignatureVerified;

    public static ApproachResult CreateSkipped(string name, string reason) =>
        new() { Name = name, IsSkipped = true, FailureReason = reason };
}
