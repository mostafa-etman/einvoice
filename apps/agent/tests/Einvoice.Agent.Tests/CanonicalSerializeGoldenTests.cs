using System.Text;
using Einvoice.Agent;
using Xunit;

namespace Einvoice.Agent.Tests;

public class CanonicalSerializeGoldenTests
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

    public static IEnumerable<object[]> LockedVectors()
    {
        var root = VectorsDir();
        foreach (var expectedPath in Directory.GetFiles(root, "gv-*.canonical.txt"))
        {
            if (expectedPath.Contains("PENDING", StringComparison.OrdinalIgnoreCase))
                continue;
            var id = Path.GetFileName(expectedPath).Replace(".canonical.txt", "");
            var inputPath = Path.Combine(root, id + ".input.json");
            yield return new object[] { id, inputPath, expectedPath };
        }
    }

    [Theory]
    [MemberData(nameof(LockedVectors))]
    public void Locked_vector_matches_byte_exact(string id, string inputPath, string expectedPath)
    {
        Assert.True(File.Exists(inputPath), $"missing input for {id}");
        var json = File.ReadAllText(inputPath, Encoding.UTF8);
        var expected = StripOneTrailingNewline(File.ReadAllText(expectedPath, Encoding.UTF8));
        var actual = StripOneTrailingNewline(CanonicalSerialize.SerializeFromJson(json));
        Assert.Equal(expected, actual);
    }

    [Fact]
    public void Discovers_at_least_gv01()
    {
        Assert.Contains(LockedVectors(), v => ((string)v[0]).Contains("gv-01"));
    }
}
