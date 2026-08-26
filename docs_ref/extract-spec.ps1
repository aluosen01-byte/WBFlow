# Extracts the embedded OpenAPI spec JSON from a downloaded dev.wildberries.cn docs page
# Usage: .\extract-spec.ps1 -HtmlFile <path> -OutFile <path>
param(
    [Parameter(Mandatory = $true)][string]$HtmlFile,
    [Parameter(Mandatory = $true)][string]$OutFile
)

$ProgressPreference = 'SilentlyContinue'
$html = [System.IO.File]::ReadAllText($HtmlFile)

$marker = 'const __redoc_state = '
$start = $html.IndexOf($marker)
if ($start -lt 0) { throw "Marker not found in $HtmlFile" }
$start += $marker.Length

# The redoc state JS object ends with "};\n\n      var container = document.getElementById('redoc')"
# Inside the JS string, newlines appear as literal backslash-n, so search for the literal sequence.
$endMarker = '\n\n      var container'
$end = $html.IndexOf($endMarker, $start)
if ($end -lt 0) { throw "End marker not found in $HtmlFile" }

# Take the raw escaped JS-string content and unescape it by parsing as a JSON string literal
$escaped = $html.Substring($start, $end - $start)
$code = $escaped | ConvertFrom-Json   # now $code is the unescaped JS code text

$braceStart = $code.IndexOf('{')
$depth = 0
$i = $braceStart
for (; $i -lt $code.Length; $i++) {
    $ch = $code[$i]
    if ($ch -eq '{') { $depth++ }
    elseif ($ch -eq '}') {
        $depth--
        if ($depth -eq 0) { break }
    }
}
$json = $code.Substring($braceStart, $i - $braceStart + 1)

$obj = $json | ConvertFrom-Json
Write-Host "Parsed OK. openapi=$($obj.openapi) info.title=$($obj.info.title)"
Write-Host "Paths: $($obj.paths.PSObject.Properties.Count)"
[System.IO.File]::WriteAllText($OutFile, $json, [System.Text.Encoding]::UTF8)
Write-Host "Spec saved to $OutFile ($($json.Length) chars)"
