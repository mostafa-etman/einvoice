using System.Text;
using Einvoice.Agent;
using Einvoice.Agent.Signing;
using Newtonsoft.Json.Linq;
using Xunit;

namespace Einvoice.Agent.Tests;

public class StripSignaturesGoldenTests
{
    private static string VectorsDir()
    {
        var cur = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (cur != null)
        {
            var candidate = Path.Combine(cur.FullName,
                "specs", "005-document-building-serialization", "golden-vectors");
            if (Directory.Exists(candidate)) return candidate;
            cur = cur.Parent;
        }

        cur = new DirectoryInfo(AppContext.BaseDirectory);
        while (cur != null)
        {
            var candidate = Path.Combine(cur.FullName,
                "specs", "005-document-building-serialization", "golden-vectors");
            if (Directory.Exists(candidate)) return candidate;
            cur = cur.Parent;
        }

        throw new DirectoryNotFoundException("golden-vectors directory not found");
    }

    private static string StripOneTrailingNewline(string s) =>
        s.EndsWith('\n') ? s[..^1] : s;

    [Fact]
    public void Gv01_plus_dummy_signatures_strip_matches_locked_expected()
    {
        var root = VectorsDir();
        var inputPath = Path.Combine(root, "gv-01-eta-sdk-one-doc.input.json");
        var expectedPath = Path.Combine(root, "gv-01-eta-sdk-one-doc.canonical.txt");
        Assert.True(File.Exists(inputPath));
        Assert.True(File.Exists(expectedPath));

        var json = File.ReadAllText(inputPath, Encoding.UTF8);
        var obj = SigningInput.ParseDocument(json);
        obj["signatures"] = new JArray
        {
            new JObject
            {
                ["signatureType"] = "I",
                ["value"] = "dummy",
            },
        };

        var actual = StripOneTrailingNewline(SigningInput.CanonicalWithoutSignatures(obj));
        var expected = StripOneTrailingNewline(File.ReadAllText(expectedPath, Encoding.UTF8));
        var baseline = StripOneTrailingNewline(CanonicalSerialize.SerializeFromJson(json));
        Assert.Equal(expected, baseline);
        Assert.Equal(expected, actual);
    }
}
