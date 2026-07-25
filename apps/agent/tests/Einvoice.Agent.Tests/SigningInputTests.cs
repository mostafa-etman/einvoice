using Newtonsoft.Json.Linq;
using Xunit;

namespace Einvoice.Agent.Tests;

public class SigningInputTests
{
    [Fact]
    public void StripSignatures_removes_signatures_property()
    {
        var doc = JObject.Parse("""{"a":1,"signatures":[{"signatureType":"I","value":"x"}],"b":"y"}""");
        var stripped = Signing.SigningInput.StripSignatures(doc);
        Assert.Null(stripped["signatures"]);
        Assert.Equal(1, (int)stripped["a"]!);
        Assert.NotNull(doc["signatures"]); // original untouched
    }
}
