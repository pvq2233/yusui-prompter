$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$taskBitmap = New-Object System.Drawing.Bitmap 256,256
$taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
$taskGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$taskGraphics.Clear([System.Drawing.Color]::Transparent)
$taskPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$taskCorner = 160
$taskPath.AddArc(0,0,$taskCorner,$taskCorner,180,90)
$taskPath.AddArc((256-$taskCorner),0,$taskCorner,$taskCorner,270,90)
$taskPath.AddArc((256-$taskCorner),(256-$taskCorner),$taskCorner,$taskCorner,0,90)
$taskPath.AddArc(0,(256-$taskCorner),$taskCorner,$taskCorner,90,90)
$taskPath.CloseFigure()
$taskBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#c0e6bb'))
$taskGraphics.FillPath($taskBrush,$taskPath)
$taskPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#173821')),13
$taskPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$taskPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
# Same six paths as the Lucide AudioLines mark in the upper-left corner.
foreach ($taskWave in @(@(2,10,13),@(6,6,17),@(10,3,21),@(14,8,15),@(18,5,18),@(22,10,13))) {
    $taskGraphics.DrawLine($taskPen,[single](50.5+$taskWave[0]*6.45),[single](50.5+$taskWave[1]*6.45),[single](50.5+$taskWave[0]*6.45),[single](50.5+$taskWave[2]*6.45))
}
$taskBitmap.Save((Join-Path $PSScriptRoot 'icon.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$taskImages = @()
foreach ($taskSize in @(16,24,32,48,64,128,256)) {
    $taskScaled = New-Object System.Drawing.Bitmap $taskSize,$taskSize
    $taskScaleGraphics = [System.Drawing.Graphics]::FromImage($taskScaled)
    $taskScaleGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $taskScaleGraphics.DrawImage($taskBitmap,0,0,$taskSize,$taskSize)
    $taskStream = New-Object System.IO.MemoryStream
    $taskScaled.Save($taskStream,[System.Drawing.Imaging.ImageFormat]::Png)
    $taskImages += [pscustomobject]@{ Size=$taskSize; Bytes=$taskStream.ToArray() }
    $taskStream.Dispose(); $taskScaleGraphics.Dispose(); $taskScaled.Dispose()
}
$taskOutput = [System.IO.File]::Create((Join-Path $PSScriptRoot 'icon.ico'))
$taskWriter = New-Object System.IO.BinaryWriter $taskOutput
try {
    $taskWriter.Write([uint16]0); $taskWriter.Write([uint16]1); $taskWriter.Write([uint16]$taskImages.Count)
    $taskOffset = 6 + 16*$taskImages.Count
    foreach ($taskImage in $taskImages) {
        $taskDimension = if ($taskImage.Size -eq 256) { 0 } else { $taskImage.Size }
        $taskWriter.Write([byte]$taskDimension); $taskWriter.Write([byte]$taskDimension)
        $taskWriter.Write([byte]0); $taskWriter.Write([byte]0); $taskWriter.Write([uint16]1); $taskWriter.Write([uint16]32)
        $taskWriter.Write([uint32]$taskImage.Bytes.Length); $taskWriter.Write([uint32]$taskOffset)
        $taskOffset += $taskImage.Bytes.Length
    }
    foreach ($taskImage in $taskImages) { $taskWriter.Write([byte[]]$taskImage.Bytes) }
} finally { $taskWriter.Dispose(); $taskOutput.Dispose(); $taskPath.Dispose(); $taskBrush.Dispose(); $taskPen.Dispose(); $taskGraphics.Dispose(); $taskBitmap.Dispose() }
