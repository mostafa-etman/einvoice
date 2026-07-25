using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Net.Pkcs11Interop.Common;
using Net.Pkcs11Interop.HighLevelAPI;
using Org.BouncyCastle.Crypto;

namespace Einvoice.Agent.Signing;

public sealed class TokenSigningContext : IDisposable
{
    public required X509Certificate2 Certificate { get; init; }
    public ISignatureFactory? SignatureFactory { get; init; }
    public AsymmetricKeyParameter? BcPrivateKey { get; init; }
    public Org.BouncyCastle.X509.X509Certificate? BcCertificate { get; init; }
    public string Source { get; init; } = "";
    private Action? _dispose;

    public void SetDisposer(Action dispose) => _dispose = dispose;

    public void Dispose()
    {
        _dispose?.Invoke();
        Certificate.Dispose();
    }
}

public interface ITokenKeyProvider
{
    /// <summary>Open token session (PIN login) and resolve eSeal cert + signer.</summary>
    TokenSigningContext Acquire(string pin);
}

/// <summary>
/// PKCS#11 provider for Egyptian eSeal tokens (eps2003csp11.dll / SignatureP11.dll).
/// </summary>
public sealed class Pkcs11KeyProvider : ITokenKeyProvider
{
    private readonly string _libraryPath;
    private readonly string? _subjectFilter;
    private readonly string? _thumbprint;

    public Pkcs11KeyProvider(string libraryPath, string? subjectFilter = null, string? thumbprint = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(libraryPath);
        _libraryPath = libraryPath;
        _subjectFilter = subjectFilter;
        _thumbprint = NormalizeThumb(thumbprint);
    }

    public object LoadSigningKey() =>
        throw new InvalidOperationException("Use Acquire(pin) for PKCS#11 signing contexts.");

    public TokenSigningContext Acquire(string pin)
    {
        if (string.IsNullOrEmpty(pin))
            throw new ArgumentException("PIN is required for PKCS#11 login.", nameof(pin));

        var factories = new Pkcs11InteropFactories();
        var pkcs11 = factories.Pkcs11LibraryFactory.LoadPkcs11Library(
            factories,
            _libraryPath,
            AppType.MultiThreaded);

        ISlot? selectedSlot = null;
        foreach (var slot in pkcs11.GetSlotList(SlotsType.WithTokenPresent))
        {
            selectedSlot = slot;
            break;
        }

        if (selectedSlot is null)
        {
            pkcs11.Dispose();
            throw new InvalidOperationException(
                $"No PKCS#11 token present in '{_libraryPath}'. Insert the eSeal USB token.");
        }

        var session = selectedSlot.OpenSession(SessionType.ReadWrite);
        try
        {
            session.Login(CKU.CKU_USER, pin);
        }
        catch (Exception ex)
        {
            session.Dispose();
            pkcs11.Dispose();
            throw new InvalidOperationException("PKCS#11 login failed (wrong PIN or locked token).", ex);
        }

        try
        {
            var (cert, keyHandle, ckaId) = FindCertificateAndKey(session);
            var factory = new Pkcs11SignatureFactory(data =>
            {
                using var mechanism = session.Factories.MechanismFactory.Create(CKM.CKM_SHA256_RSA_PKCS);
                return session.Sign(mechanism, keyHandle, data);
            });

            var ctx = new TokenSigningContext
            {
                Certificate = cert,
                SignatureFactory = factory,
                Source = $"PKCS#11:{Path.GetFileName(_libraryPath)}",
            };
            ctx.SetDisposer(() =>
            {
                try { session.Logout(); } catch { /* ignore */ }
                session.Dispose();
                pkcs11.Dispose();
            });
            _ = ckaId;
            return ctx;
        }
        catch
        {
            try { session.Logout(); } catch { /* ignore */ }
            session.Dispose();
            pkcs11.Dispose();
            throw;
        }
    }

    private (X509Certificate2 Cert, IObjectHandle KeyHandle, byte[] CkaId) FindCertificateAndKey(ISession session)
    {
        var certTemplate = new List<IObjectAttribute>
        {
            session.Factories.ObjectAttributeFactory.Create(CKA.CKA_CLASS, CKO.CKO_CERTIFICATE),
            session.Factories.ObjectAttributeFactory.Create(CKA.CKA_CERTIFICATE_TYPE, CKC.CKC_X_509),
            session.Factories.ObjectAttributeFactory.Create(CKA.CKA_TOKEN, true),
        };

        var certHandles = session.FindAllObjects(certTemplate);
        if (certHandles.Count == 0)
            throw new InvalidOperationException("No X.509 certificates found on the PKCS#11 token.");

        foreach (var certHandle in certHandles)
        {
            var attrs = session.GetAttributeValue(certHandle, new List<CKA> { CKA.CKA_VALUE, CKA.CKA_ID });
            var der = attrs[0].GetValueAsByteArray();
            var ckaId = attrs[1].GetValueAsByteArray();
            var cert = new X509Certificate2(der);

            if (!MatchesFilter(cert))
            {
                cert.Dispose();
                continue;
            }

            var keyTemplate = new List<IObjectAttribute>
            {
                session.Factories.ObjectAttributeFactory.Create(CKA.CKA_CLASS, CKO.CKO_PRIVATE_KEY),
                session.Factories.ObjectAttributeFactory.Create(CKA.CKA_KEY_TYPE, CKK.CKK_RSA),
                session.Factories.ObjectAttributeFactory.Create(CKA.CKA_ID, ckaId),
            };
            var keys = session.FindAllObjects(keyTemplate);
            if (keys.Count == 0)
            {
                // Fallback: any private RSA key on token
                keyTemplate = new List<IObjectAttribute>
                {
                    session.Factories.ObjectAttributeFactory.Create(CKA.CKA_CLASS, CKO.CKO_PRIVATE_KEY),
                    session.Factories.ObjectAttributeFactory.Create(CKA.CKA_KEY_TYPE, CKK.CKK_RSA),
                    session.Factories.ObjectAttributeFactory.Create(CKA.CKA_SIGN, true),
                };
                keys = session.FindAllObjects(keyTemplate);
            }

            if (keys.Count == 0)
            {
                cert.Dispose();
                continue;
            }

            return (cert, keys[0], ckaId);
        }

        throw new InvalidOperationException(
            "No matching eSeal certificate/private key on token. " +
            "Adjust EINVOICE_CERT_FILTER / EINVOICE_CERT_THUMBPRINT.");
    }

    private bool MatchesFilter(X509Certificate2 cert)
    {
        if (!string.IsNullOrWhiteSpace(_thumbprint))
            return string.Equals(NormalizeThumb(cert.Thumbprint), _thumbprint, StringComparison.OrdinalIgnoreCase);

        if (string.IsNullOrWhiteSpace(_subjectFilter))
            return true;

        var hay = $"{cert.Subject} {cert.Issuer}";
        return hay.Contains(_subjectFilter, StringComparison.OrdinalIgnoreCase);
    }

    private static string? NormalizeThumb(string? t) =>
        string.IsNullOrWhiteSpace(t) ? null : t.Replace(" ", "", StringComparison.Ordinal).ToUpperInvariant();

    /// <summary>Probe well-known ETA token PKCS#11 module paths on Windows.</summary>
    public static string? ProbeDefaultLibraryPath()
    {
        var candidates = new[]
        {
            Environment.GetEnvironmentVariable("EINVOICE_PKCS11_LIBRARY"),
            Path.Combine(Environment.SystemDirectory, "eps2003csp11.dll"),
            Path.Combine(Environment.SystemDirectory, "SignatureP11.dll"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "eps2003csp11.dll"),
            @"C:\Windows\System32\eps2003csp11.dll",
            @"C:\Windows\System32\SignatureP11.dll",
            @"C:\Windows\SysWOW64\eps2003csp11.dll",
        };

        foreach (var c in candidates)
        {
            if (!string.IsNullOrWhiteSpace(c) && File.Exists(c))
                return c;
        }

        return null;
    }
}
