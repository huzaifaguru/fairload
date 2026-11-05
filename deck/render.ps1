param([string]$Deck, [string]$OutDir)
New-Item -ItemType Directory -Force $OutDir | Out-Null
Get-ChildItem $OutDir -Filter *.png -ErrorAction SilentlyContinue | Remove-Item -Force -Confirm:$false
$app = New-Object -ComObject PowerPoint.Application
try {
  $p = $app.Presentations.Open($Deck, -1, 0, 0)
  $n = $p.Slides.Count
  for ($i = 1; $i -le $n; $i++) {
    $p.Slides.Item($i).Export((Join-Path $OutDir ("slide-{0:d2}.png" -f $i)), "PNG", 1280, 720)
  }
  "exported $n slides"
  $p.Close()
} finally { $app.Quit() }
