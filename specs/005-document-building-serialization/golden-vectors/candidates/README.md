# Candidates from `tools/reference-canonical-serialize`

Outputs of the **exact** `SerializeToken` port from bassemAgmi/EInvoicingSigner.
These are **not** locked golden expecteds until matched to a real
`CanonicalString.txt` from EInvoicingSigner (see `../RUNBOOK-bassemAgmi.md`).

Regenerate:

```powershell
cd tools\reference-canonical-serialize
$gv = "..\..\specs\005-document-building-serialization\golden-vectors"
Get-ChildItem $gv\gv-*.input.json | ForEach-Object {
  $id = $_.BaseName -replace '\.input$',''
  dotnet run -c Release -- $_.FullName "$gv\candidates\$id.canonical.CANDIDATE.txt"
}
```
