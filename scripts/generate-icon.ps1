Add-Type -AssemblyName System.Drawing
$outDir = Join-Path $PSScriptRoot '..\build'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$bmp = New-Object System.Drawing.Bitmap 512, 512
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

$diamond = [System.Drawing.Point[]]@(
  (New-Object System.Drawing.Point 256,18),
  (New-Object System.Drawing.Point 494,256),
  (New-Object System.Drawing.Point 256,494),
  (New-Object System.Drawing.Point 18,256)
)
$gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point 80,70),
  (New-Object System.Drawing.Point 430,450),
  ([System.Drawing.Color]::FromArgb(255,20,78,117)),
  ([System.Drawing.Color]::FromArgb(255,5,24,42))
)
$g.FillPolygon($gradient, $diamond)
$outerPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255,105,193,255)), 15
$innerPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(155,151,225,255)), 4
$g.DrawPolygon($outerPen, $diamond)
$inner = [System.Drawing.Point[]]@(
  (New-Object System.Drawing.Point 256,48),
  (New-Object System.Drawing.Point 464,256),
  (New-Object System.Drawing.Point 256,464),
  (New-Object System.Drawing.Point 48,256)
)
$g.DrawPolygon($innerPen, $inner)

$anchorPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255,239,250,255)), 22
$anchorPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$anchorPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawEllipse($anchorPen, 226,94,60,60)
$g.DrawLine($anchorPen, 256,154,256,354)
$g.DrawLine($anchorPen, 189,208,323,208)
$anchorPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$anchorPath.AddBezier(138,300,154,405,225,421,256,356)
$anchorPath.AddBezier(256,356,287,421,358,405,374,300)
$g.DrawPath($anchorPen, $anchorPath)
$g.FillPolygon((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,239,250,255))), [System.Drawing.Point[]]@(
  (New-Object System.Drawing.Point 118,285),
  (New-Object System.Drawing.Point 171,302),
  (New-Object System.Drawing.Point 139,338)
))
$g.FillPolygon((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,239,250,255))), [System.Drawing.Point[]]@(
  (New-Object System.Drawing.Point 394,285),
  (New-Object System.Drawing.Point 341,302),
  (New-Object System.Drawing.Point 373,338)
))

$bmp.Save((Join-Path $outDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$anchorPath.Dispose(); $anchorPen.Dispose(); $innerPen.Dispose(); $outerPen.Dispose(); $gradient.Dispose(); $g.Dispose(); $bmp.Dispose()
