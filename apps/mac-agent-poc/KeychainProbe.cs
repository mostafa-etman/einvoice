using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;

namespace Einvoice.MacAgentPoc;

/// <summary>
/// Approach B — macOS Keychain / Security.framework.
/// Finds the eSeal cert, checks whether a usable private key (SecIdentity / RSA) exists,
/// then attempts the same RSA-SHA256 PKCS#1 test signature.
/// </summary>
internal static class KeychainProbe
{
    private const string SecurityPath = "/System/Library/Frameworks/Security.framework/Security";
    private const string CoreFoundationPath = "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation";
    private const uint Utf8 = 0x08000100;
    private const int ErrSecSuccess = 0;
    private const int ErrSecItemNotFound = -25300;
    private const int KSecKeyOperationTypeSign = 1;

    public static ApproachResult Run(CliOptions options)
    {
        Console.WriteLine("=== APPROACH B: macOS Keychain (Security.framework) ===");
        var result = new ApproachResult { Name = "Keychain" };

        if (!OperatingSystem.IsMacOS())
        {
            result.FailureReason =
                $"Not macOS (OS={RuntimeInformation.OSDescription.Trim()}). Keychain probe only runs on the Mac.";
            Console.WriteLine("Keychain loaded: NO (this process is not running on macOS).");
            Console.WriteLine(result.FailureReason);
            Console.WriteLine();
            return result;
        }

        Console.WriteLine("Note: Keychain/CryptoTokenKit may show a system PIN dialog. This tool cannot inject the PIN.");
        Console.WriteLine("Filter: subject={0}  issuer={1}",
            string.IsNullOrWhiteSpace(options.Subject) ? "(any)" : options.Subject,
            string.IsNullOrWhiteSpace(options.Issuer) ? "(any)" : options.Issuer);

        var storeCerts = ListStoreCertificates(options);
        Console.WriteLine("X509Store (My / CurrentUser + LocalMachine): {0} matching cert(s)", storeCerts.Count);
        foreach (var c in storeCerts)
        {
            Console.WriteLine("  HasPrivateKey={0}  {1}", Program.Yn(c.HasPrivateKey), Program.FormatCert(c));
        }

        if (storeCerts.Count > 0)
            result.CertificateFound = true;

        var native = TryNativeSearch(options, result);

        var signCandidates = new List<SignAttempt>();
        foreach (var cert in storeCerts.OrderByDescending(Program.EsealScore))
        {
            signCandidates.Add(new SignAttempt(cert, "X509Store.GetRSAPrivateKey", ViaStore: true, Identity: IntPtr.Zero, Key: IntPtr.Zero));
        }

        foreach (var n in native)
            signCandidates.Add(n);

        if (signCandidates.Count == 0)
        {
            result.LibraryOrStoreLoaded = true;
            result.FailureReason =
                "No matching certificate in Keychain stores or Security.framework identity/certificate search. " +
                "If you only exported/installed the public cert, that is expected — the private key stays on the token.";
            Console.WriteLine("Certificate found: NO");
            Console.WriteLine(result.FailureReason);
            PrintApproachFooter(result);
            return result;
        }

        result.LibraryOrStoreLoaded = true;
        result.CertificateFound = true;

        var anyPrivate = storeCerts.Any(c => c.HasPrivateKey) || native.Any(n => n.Key != IntPtr.Zero || !n.ViaStore);
        if (!anyPrivate && storeCerts.All(c => !c.HasPrivateKey) && native.Count == 0)
        {
            result.CertificateSubject = storeCerts.OrderByDescending(Program.EsealScore).First().Subject;
            result.PrivateKeyUsable = false;
            result.FailureReason =
                "Certificate is in the Keychain but no usable private key / SecIdentity was found. " +
                "Typical after installing only the public eSeal cert: the PIN-protected key remains on the USB token " +
                "and is reachable via PKCS#11, not Keychain.";
            Console.WriteLine("Private key usable: NO (public certificate only)");
            Console.WriteLine(result.FailureReason);
            PrintApproachFooter(result);
            DisposeNative(native);
            DisposeCerts(storeCerts);
            return result;
        }

        foreach (var attempt in Deduplicate(signCandidates))
        {
            result.CertificateSubject = attempt.Cert.Subject;
            Console.WriteLine();
            Console.WriteLine("Trying sign via {0}", attempt.Label);
            Console.WriteLine("  {0}", Program.FormatCert(attempt.Cert));

            if (TrySign(attempt, result))
                break;
        }

        if (!result.Succeeded && !result.PrivateKeyUsable)
        {
            result.FailureReason ??=
                "Matching certificate found, but the private key is not usable for signing through Keychain " +
                "(HasPrivateKey=false and no SecIdentity private key). Public cert only.";
            Console.WriteLine("Private key usable: NO");
        }
        else if (!result.Succeeded)
        {
            result.FailureReason ??= "Private key appeared present but RSA-SHA256 sign/verify did not succeed.";
        }

        DisposeNative(native);
        DisposeCerts(storeCerts);
        PrintApproachFooter(result);
        return result;
    }

    private static void PrintApproachFooter(ApproachResult result)
    {
        Console.WriteLine();
        Console.WriteLine(
            "Approach B result: loaded={0} cert={1} privkey={2} signed={3} verified={4} => {5}",
            Program.Yn(result.LibraryOrStoreLoaded),
            Program.Yn(result.CertificateFound),
            Program.Yn(result.PrivateKeyUsable),
            Program.Yn(result.SignatureProduced),
            Program.Yn(result.SignatureVerified),
            result.Succeeded ? "PASS" : "FAIL");
        Console.WriteLine();
    }

    private static List<X509Certificate2> ListStoreCertificates(CliOptions options)
    {
        var found = new List<X509Certificate2>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var location in new[] { StoreLocation.CurrentUser, StoreLocation.LocalMachine })
        {
            try
            {
                using var store = new X509Store(StoreName.My, location);
                store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
                Console.WriteLine("Opened X509Store My/{0}: {1} cert(s) total", location, store.Certificates.Count);
                foreach (var cert in store.Certificates)
                {
                    if (!Program.MatchesFilter(cert, options))
                    {
                        cert.Dispose();
                        continue;
                    }

                    if (!seen.Add(cert.Thumbprint ?? cert.Subject))
                    {
                        cert.Dispose();
                        continue;
                    }

                    found.Add(cert);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("X509Store My/{0}: could not open ({1})", location, ex.Message);
            }
        }

        return found;
    }

    private static List<SignAttempt> TryNativeSearch(CliOptions options, ApproachResult result)
    {
        var attempts = new List<SignAttempt>();
        if (!NativeLibrary.TryLoad(SecurityPath, out var sec) ||
            !NativeLibrary.TryLoad(CoreFoundationPath, out var cf))
        {
            Console.WriteLine("Security.framework: could not load native libraries.");
            return attempts;
        }

        try
        {
            var api = new SecApi(sec, cf);
            result.LibraryOrStoreLoaded = true;
            Console.WriteLine("Security.framework loaded: YES");

            var identities = api.CopyMatching(api.KSecClassIdentity);
            Console.WriteLine("SecItem identities: {0}", identities.Count);
            foreach (var identity in identities)
            {
                if (api.SecIdentityCopyCertificate(identity, out var certRef) != ErrSecSuccess || certRef == IntPtr.Zero)
                    continue;

                X509Certificate2? cert = null;
                try
                {
                    cert = api.CertFromRef(certRef);
                    if (!Program.MatchesFilter(cert, options))
                    {
                        cert.Dispose();
                        continue;
                    }

                    Console.WriteLine("  identity  {0}", Program.FormatCert(cert));
                    IntPtr key = IntPtr.Zero;
                    var keyStatus = api.SecIdentityCopyPrivateKey(identity, out key);
                    Console.WriteLine("           SecIdentityCopyPrivateKey status={0} key={1}",
                        keyStatus,
                        key != IntPtr.Zero ? "YES" : "NO");

                    attempts.Add(new SignAttempt(
                        cert,
                        "SecIdentity/SecKeyCreateSignature",
                        ViaStore: false,
                        Identity: identity,
                        Key: key));
                    cert = null; // owned by SignAttempt
                }
                catch (Exception ex)
                {
                    Console.WriteLine("  identity read failed: {0}", ex.Message);
                    cert?.Dispose();
                }
                finally
                {
                    api.CFRelease(certRef);
                }
            }

            var certItems = api.CopyMatching(api.KSecClassCertificate);
            Console.WriteLine("SecItem certificates: {0}", certItems.Count);
            var identityThumbs = new HashSet<string>(
                attempts.Select(a => a.Cert.Thumbprint ?? ""),
                StringComparer.OrdinalIgnoreCase);

            foreach (var certRef in certItems)
            {
                try
                {
                    using var cert = api.CertFromRef(certRef);
                    if (!Program.MatchesFilter(cert, options))
                        continue;
                    var tagged = identityThumbs.Contains(cert.Thumbprint ?? "")
                        ? "also-has-identity"
                        : "cert-only";
                    Console.WriteLine("  [{0}] {1}", tagged, Program.FormatCert(cert));
                    if (tagged == "cert-only" && !result.CertificateFound)
                        result.CertificateFound = true;
                }
                catch (Exception ex)
                {
                    Console.WriteLine("  certificate read failed: {0}", ex.Message);
                }
                finally
                {
                    api.CFRelease(certRef);
                }
            }

            if (identities.Count == 0 && certItems.Count == 0)
                Console.WriteLine("  (SecItemCopyMatching returned no identities and no certificates)");

            return attempts;
        }
        catch (Exception ex)
        {
            Console.WriteLine("Security.framework search failed: {0}", ex.Message);
            return attempts;
        }
    }

    private static bool TrySign(SignAttempt attempt, ApproachResult result)
    {
        if (attempt.ViaStore)
        {
            if (!attempt.Cert.HasPrivateKey)
            {
                Console.WriteLine("  HasPrivateKey=NO — store copy is public cert only.");
                return false;
            }

            try
            {
                using var rsa = attempt.Cert.GetRSAPrivateKey();
                if (rsa is null)
                {
                    Console.WriteLine("  GetRSAPrivateKey() returned null.");
                    return false;
                }

                result.PrivateKeyUsable = true;
                var signature = rsa.SignData(
                    Program.SamplePayload,
                    HashAlgorithmName.SHA256,
                    RSASignaturePadding.Pkcs1);
                return FinishSignature(attempt.Cert, signature, "X509Store RSA.SignData", result);
            }
            catch (Exception ex)
            {
                Console.WriteLine("  GetRSAPrivateKey/SignData failed: {0}", ex.Message);
                return false;
            }
        }

        if (attempt.Key == IntPtr.Zero)
        {
            Console.WriteLine("  SecIdentity has no private key ref.");
            return false;
        }

        if (!NativeLibrary.TryLoad(SecurityPath, out var sec) ||
            !NativeLibrary.TryLoad(CoreFoundationPath, out var cf))
        {
            return false;
        }

        try
        {
            var api = new SecApi(sec, cf);
            if (api.KSecKeyAlgorithmRsaSha256Pkcs1 == IntPtr.Zero)
            {
                Console.WriteLine("  kSecKeyAlgorithmRSASignatureMessagePKCS1v15SHA256 not available.");
                return false;
            }

            var supported = api.SecKeyIsAlgorithmSupported(
                attempt.Key,
                KSecKeyOperationTypeSign,
                api.KSecKeyAlgorithmRsaSha256Pkcs1);
            Console.WriteLine("  SecKeyIsAlgorithmSupported(sign, RSA-SHA256-PKCS1)={0}", Program.Yn(supported != 0));
            if (supported == 0)
            {
                result.PrivateKeyUsable = true;
                Console.WriteLine("  Key exists but this algorithm is not supported via Keychain.");
                return false;
            }

            result.PrivateKeyUsable = true;
            var data = api.CFDataCreate(Program.SamplePayload);
            try
            {
                var sig = api.SecKeyCreateSignature(
                    attempt.Key,
                    api.KSecKeyAlgorithmRsaSha256Pkcs1,
                    data,
                    out var error);
                if (sig == IntPtr.Zero)
                {
                    Console.WriteLine("  SecKeyCreateSignature failed: {0}", api.ErrorMessage(error));
                    if (error != IntPtr.Zero)
                        api.CFRelease(error);
                    return false;
                }

                try
                {
                    var signature = api.CfDataToBytes(sig);
                    return FinishSignature(attempt.Cert, signature, "SecKeyCreateSignature", result);
                }
                finally
                {
                    api.CFRelease(sig);
                }
            }
            finally
            {
                api.CFRelease(data);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("  SecKeyCreateSignature path failed: {0}", ex.Message);
            return false;
        }
    }

    private static bool FinishSignature(X509Certificate2 cert, byte[] signature, string how, ApproachResult result)
    {
        result.SignatureProduced = signature.Length > 0;
        Console.WriteLine("  Signature: {0} ({1} bytes via {2})", Program.Yn(result.SignatureProduced), signature.Length, how);
        var ok = result.SignatureProduced && Program.VerifyRsaSha256Pkcs1(cert, Program.SamplePayload, signature);
        result.SignatureVerified = ok;
        Console.WriteLine("  Verified:  {0} (RSA-SHA256 PKCS#1 vs certificate public key)", Program.Yn(ok));
        if (!ok)
            result.FailureReason = $"Signature produced via {how} but did not verify against the public key.";
        return result.Succeeded;
    }

    private static IEnumerable<SignAttempt> Deduplicate(List<SignAttempt> attempts)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var a in attempts)
        {
            var key = $"{a.Label}|{a.Cert.Thumbprint}";
            if (seen.Add(key))
                yield return a;
        }
    }

    private static void DisposeCerts(List<X509Certificate2> certs)
    {
        foreach (var c in certs)
            c.Dispose();
    }

    private static void DisposeNative(List<SignAttempt> native)
    {
        foreach (var n in native)
            n.Cert.Dispose();
    }

    private sealed record SignAttempt(
        X509Certificate2 Cert,
        string Label,
        bool ViaStore,
        IntPtr Identity,
        IntPtr Key);

    private sealed class SecApi
    {
        private readonly IntPtr _sec;
        private readonly IntPtr _cf;

        public readonly IntPtr KSecClass;
        public readonly IntPtr KSecClassIdentity;
        public readonly IntPtr KSecClassCertificate;
        public readonly IntPtr KSecMatchLimit;
        public readonly IntPtr KSecMatchLimitAll;
        public readonly IntPtr KSecReturnRef;
        public readonly IntPtr KCfBooleanTrue;
        public readonly IntPtr KSecKeyAlgorithmRsaSha256Pkcs1;

        private readonly CopyMatchingDelegate _copyMatching;
        private readonly IdentityCopyCertDelegate _identityCopyCert;
        private readonly IdentityCopyKeyDelegate _identityCopyKey;
        private readonly CertCopyDataDelegate _certCopyData;
        private readonly KeyIsAlgoDelegate _keyIsAlgo;
        private readonly KeyCreateSigDelegate _keyCreateSig;
        private readonly CfDictCreateDelegate _cfDictCreate;
        private readonly CfReleaseDelegate _cfRelease;
        private readonly CfArrayCountDelegate _cfArrayCount;
        private readonly CfArrayValueDelegate _cfArrayValue;
        private readonly CfGetTypeIdDelegate _cfGetTypeId;
        private readonly CfArrayTypeIdDelegate _cfArrayTypeId;
        private readonly CfDataCreateDelegate _cfDataCreate;
        private readonly CfDataLengthDelegate _cfDataLength;
        private readonly CfDataBytePtrDelegate _cfDataBytePtr;
        private readonly CfErrorCopyDescDelegate _cfErrorCopyDesc;
        private readonly CfStringGetCStringDelegate _cfStringGetCString;
        private readonly CfStringGetLengthDelegate _cfStringGetLength;

        public SecApi(IntPtr sec, IntPtr cf)
        {
            _sec = sec;
            _cf = cf;
            KSecClass = ReadRef(sec, "kSecClass");
            KSecClassIdentity = ReadRef(sec, "kSecClassIdentity");
            KSecClassCertificate = ReadRef(sec, "kSecClassCertificate");
            KSecMatchLimit = ReadRef(sec, "kSecMatchLimit");
            KSecMatchLimitAll = ReadRef(sec, "kSecMatchLimitAll");
            KSecReturnRef = ReadRef(sec, "kSecReturnRef");
            KCfBooleanTrue = ReadRef(cf, "kCFBooleanTrue");
            KSecKeyAlgorithmRsaSha256Pkcs1 = TryReadRef(sec, "kSecKeyAlgorithmRSASignatureMessagePKCS1v15SHA256");

            _copyMatching = Load<CopyMatchingDelegate>(sec, "SecItemCopyMatching");
            _identityCopyCert = Load<IdentityCopyCertDelegate>(sec, "SecIdentityCopyCertificate");
            _identityCopyKey = Load<IdentityCopyKeyDelegate>(sec, "SecIdentityCopyPrivateKey");
            _certCopyData = Load<CertCopyDataDelegate>(sec, "SecCertificateCopyData");
            _keyIsAlgo = Load<KeyIsAlgoDelegate>(sec, "SecKeyIsAlgorithmSupported");
            _keyCreateSig = Load<KeyCreateSigDelegate>(sec, "SecKeyCreateSignature");
            _cfDictCreate = Load<CfDictCreateDelegate>(cf, "CFDictionaryCreate");
            _cfRelease = Load<CfReleaseDelegate>(cf, "CFRelease");
            _cfArrayCount = Load<CfArrayCountDelegate>(cf, "CFArrayGetCount");
            _cfArrayValue = Load<CfArrayValueDelegate>(cf, "CFArrayGetValueAtIndex");
            _cfGetTypeId = Load<CfGetTypeIdDelegate>(cf, "CFGetTypeID");
            _cfArrayTypeId = Load<CfArrayTypeIdDelegate>(cf, "CFArrayGetTypeID");
            _cfDataCreate = Load<CfDataCreateDelegate>(cf, "CFDataCreate");
            _cfDataLength = Load<CfDataLengthDelegate>(cf, "CFDataGetLength");
            _cfDataBytePtr = Load<CfDataBytePtrDelegate>(cf, "CFDataGetBytePtr");
            _cfErrorCopyDesc = Load<CfErrorCopyDescDelegate>(cf, "CFErrorCopyDescription");
            _cfStringGetCString = Load<CfStringGetCStringDelegate>(cf, "CFStringGetCString");
            _cfStringGetLength = Load<CfStringGetLengthDelegate>(cf, "CFStringGetLength");
        }

        public int SecIdentityCopyCertificate(IntPtr identity, out IntPtr certificate) =>
            _identityCopyCert(identity, out certificate);

        public int SecIdentityCopyPrivateKey(IntPtr identity, out IntPtr privateKey) =>
            _identityCopyKey(identity, out privateKey);

        public byte SecKeyIsAlgorithmSupported(IntPtr key, int operation, IntPtr algorithm) =>
            _keyIsAlgo(key, operation, algorithm);

        public IntPtr SecKeyCreateSignature(IntPtr key, IntPtr algorithm, IntPtr data, out IntPtr error) =>
            _keyCreateSig(key, algorithm, data, out error);

        public void CFRelease(IntPtr cf)
        {
            if (cf != IntPtr.Zero)
                _cfRelease(cf);
        }

        public IntPtr CFDataCreate(byte[] bytes)
        {
            var handle = GCHandle.Alloc(bytes, GCHandleType.Pinned);
            try
            {
                return _cfDataCreate(IntPtr.Zero, handle.AddrOfPinnedObject(), bytes.Length);
            }
            finally
            {
                handle.Free();
            }
        }

        public byte[] CfDataToBytes(IntPtr data)
        {
            var len = (int)_cfDataLength(data);
            var ptr = _cfDataBytePtr(data);
            var bytes = new byte[len];
            Marshal.Copy(ptr, bytes, 0, len);
            return bytes;
        }

        public X509Certificate2 CertFromRef(IntPtr certRef)
        {
            var data = _certCopyData(certRef);
            if (data == IntPtr.Zero)
                throw new InvalidOperationException("SecCertificateCopyData returned null.");
            try
            {
                return new X509Certificate2(CfDataToBytes(data));
            }
            finally
            {
                CFRelease(data);
            }
        }

        public string ErrorMessage(IntPtr error)
        {
            if (error == IntPtr.Zero)
                return "(no CFError)";
            var desc = _cfErrorCopyDesc(error);
            if (desc == IntPtr.Zero)
                return "(no description)";
            try
            {
                return CfStringToString(desc);
            }
            finally
            {
                CFRelease(desc);
            }
        }

        public List<IntPtr> CopyMatching(IntPtr secClass)
        {
            var keys = new[] { KSecClass, KSecMatchLimit, KSecReturnRef };
            var values = new[] { secClass, KSecMatchLimitAll, KCfBooleanTrue };
            var keysHandle = GCHandle.Alloc(keys, GCHandleType.Pinned);
            var valuesHandle = GCHandle.Alloc(values, GCHandleType.Pinned);
            IntPtr dict = IntPtr.Zero;
            try
            {
                dict = _cfDictCreate(
                    IntPtr.Zero,
                    keysHandle.AddrOfPinnedObject(),
                    valuesHandle.AddrOfPinnedObject(),
                    keys.Length,
                    IntPtr.Zero,
                    IntPtr.Zero);
                var status = _copyMatching(dict, out var found);
                if (status == ErrSecItemNotFound || found == IntPtr.Zero)
                    return [];
                if (status != ErrSecSuccess)
                    throw new InvalidOperationException($"SecItemCopyMatching status={status}");

                try
                {
                    return FlattenRefs(found);
                }
                finally
                {
                    CFRelease(found);
                }
            }
            finally
            {
                if (dict != IntPtr.Zero)
                    CFRelease(dict);
                keysHandle.Free();
                valuesHandle.Free();
            }
        }

        private List<IntPtr> FlattenRefs(IntPtr found)
        {
            var list = new List<IntPtr>();
            if (_cfGetTypeId(found) == _cfArrayTypeId())
            {
                var count = _cfArrayCount(found);
                for (nint i = 0; i < count; i++)
                {
                    var item = _cfArrayValue(found, i);
                    if (item == IntPtr.Zero)
                        continue;
                    _cfRetain(item);
                    list.Add(item);
                }
            }
            else
            {
                _cfRetain(found);
                list.Add(found);
            }

            return list;
        }

        private void _cfRetain(IntPtr item)
        {
            var retain = Load<CfRetainDelegate>(_cf, "CFRetain");
            retain(item);
        }

        private string CfStringToString(IntPtr cfString)
        {
            var len = (int)_cfStringGetLength(cfString);
            var buf = new byte[checked((len + 1) * 4)];
            if (_cfStringGetCString(cfString, buf, buf.Length, Utf8) == 0)
                return "(unreadable CFString)";
            var n = Array.IndexOf(buf, (byte)0);
            return Encoding.UTF8.GetString(buf, 0, n < 0 ? buf.Length : n);
        }

        private static IntPtr ReadRef(IntPtr lib, string name)
        {
            var value = TryReadRef(lib, name);
            if (value == IntPtr.Zero)
                throw new InvalidOperationException($"Missing native export {name}");
            return value;
        }

        private static IntPtr TryReadRef(IntPtr lib, string name)
        {
            if (!NativeLibrary.TryGetExport(lib, name, out var addr) || addr == IntPtr.Zero)
                return IntPtr.Zero;
            return Marshal.ReadIntPtr(addr);
        }

        private static T Load<T>(IntPtr lib, string name) where T : Delegate
        {
            if (!NativeLibrary.TryGetExport(lib, name, out var addr) || addr == IntPtr.Zero)
                throw new InvalidOperationException($"Missing native export {name}");
            return Marshal.GetDelegateForFunctionPointer<T>(addr);
        }

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int CopyMatchingDelegate(IntPtr query, out IntPtr result);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int IdentityCopyCertDelegate(IntPtr identity, out IntPtr certificate);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int IdentityCopyKeyDelegate(IntPtr identity, out IntPtr privateKey);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr CertCopyDataDelegate(IntPtr certificate);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate byte KeyIsAlgoDelegate(IntPtr key, int operation, IntPtr algorithm);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr KeyCreateSigDelegate(IntPtr key, IntPtr algorithm, IntPtr data, out IntPtr error);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr CfDictCreateDelegate(
            IntPtr allocator, IntPtr keys, IntPtr values, nint n, IntPtr keyCb, IntPtr valueCb);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate void CfReleaseDelegate(IntPtr cf);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr CfRetainDelegate(IntPtr cf);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate nint CfArrayCountDelegate(IntPtr array);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr CfArrayValueDelegate(IntPtr array, nint index);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate nuint CfGetTypeIdDelegate(IntPtr cf);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate nuint CfArrayTypeIdDelegate();

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr CfDataCreateDelegate(IntPtr allocator, IntPtr bytes, nint length);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate nint CfDataLengthDelegate(IntPtr data);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr CfDataBytePtrDelegate(IntPtr data);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr CfErrorCopyDescDelegate(IntPtr error);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate byte CfStringGetCStringDelegate(IntPtr s, byte[] buffer, nint size, uint encoding);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate nint CfStringGetLengthDelegate(IntPtr s);
    }
}
