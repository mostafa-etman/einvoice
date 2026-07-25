using System.Text;
using Einvoice.Agent;

if (args.Length < 1)
{
    Console.Error.WriteLine("usage: ParityAgent <input.json> [out.txt]");
    return 2;
}

var json = File.ReadAllText(args[0], Encoding.UTF8);
var canonical = CanonicalSerialize.SerializeFromJson(json);
if (canonical.EndsWith('\n')) canonical = canonical[..^1];

if (args.Length >= 2)
{
    File.WriteAllText(args[1], canonical, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
}
else
{
    Console.Out.Write(canonical);
}

return 0;
