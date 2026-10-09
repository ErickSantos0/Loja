Add-Type -AssemblyName System.Drawing
$iconSizes = @(16, 32, 48, 64, 128, 256)
$iconFrames = @()
foreach ($iconSize in $iconSizes) {
  $bitmap = New-Object System.Drawing.Bitmap($iconSize, $iconSize)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::FromArgb(37, 38, 91))
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(198, 250, 120))
  $unit = $iconSize / 256.0
  $graphics.FillRectangle($brush, [single](75 * $unit), [single](58 * $unit), [single](34 * $unit), [single](143 * $unit))
  $graphics.FillRectangle($brush, [single](96 * $unit), [single](58 * $unit), [single](86 * $unit), [single](31 * $unit))
  $graphics.FillRectangle($brush, [single](96 * $unit), [single](117 * $unit), [single](69 * $unit), [single](29 * $unit))
  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $iconFrames += ,@{ Size = $iconSize; Bytes = $stream.ToArray() }
  $stream.Dispose(); $brush.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
$outputPath = Join-Path $PSScriptRoot 'icon.ico'
$file = [System.IO.File]::Create($outputPath)
$writer = New-Object System.IO.BinaryWriter($file)
try {
  $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$iconFrames.Count)
  $offset = 6 + 16 * $iconFrames.Count
  foreach ($frame in $iconFrames) {
    $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
    $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
    $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([uint16]1); $writer.Write([uint16]32)
    $writer.Write([uint32]$frame.Bytes.Length); $writer.Write([uint32]$offset)
    $offset += $frame.Bytes.Length
  }
  foreach ($frame in $iconFrames) { $writer.Write([byte[]]$frame.Bytes) }
} finally { $writer.Dispose(); $file.Dispose() }
