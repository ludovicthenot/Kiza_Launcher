
Add-Type -AssemblyName System.Drawing

$baseDir = "C:\Users\nefer\Desktop\Projet\Kiza Mods\KizaaModEngine-Tauri"
$iconPath = Join-Path $baseDir "src-tauri\icons\icon.png"
$sidebarPath = Join-Path $baseDir "src-tauri\icons\installer_sidebar.bmp"
$headerPath = Join-Path $baseDir "src-tauri\icons\installer_header.bmp"

# Use a dark background color matching the app theme
$bgColor = [System.Drawing.ColorTranslator]::FromHtml("#0f172a") 

function Create-Bmp {
    param(
        [string]$InputFile,
        [string]$OutputFile,
        [int]$Width,
        [int]$Height,
        [int]$IconSize
    )

    if (-not (Test-Path $InputFile)) {
        Write-Error "Input file not found: $InputFile"
        return
    }

    $srcImage = [System.Drawing.Image]::FromFile($InputFile)
    $bitmap = New-Object System.Drawing.Bitmap($Width, $Height)
    $graph = [System.Drawing.Graphics]::FromImage($bitmap)
    
    # Fill background
    $brush = New-Object System.Drawing.SolidBrush($bgColor)
    $graph.FillRectangle($brush, 0, 0, $Width, $Height)
    
    # Calculate center position
    $x = [math]::Round(($Width - $IconSize) / 2)
    $y = [math]::Round(($Height - $IconSize) / 2)
    
    # Draw icon centered
    $graph.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graph.DrawImage($srcImage, $x, $y, $IconSize, $IconSize)
    
    $bitmap.Save($OutputFile, [System.Drawing.Imaging.ImageFormat]::Bmp)
    
    $graph.Dispose()
    $bitmap.Dispose()
    $srcImage.Dispose()
    $brush.Dispose()
    
    Write-Host "Created $OutputFile"
}

# Create Sidebar (164x314) - Icon 100x100
Create-Bmp -InputFile $iconPath -OutputFile $sidebarPath -Width 164 -Height 314 -IconSize 100

# Create Header (150x57) - Icon 40x40
Create-Bmp -InputFile $iconPath -OutputFile $headerPath -Width 150 -Height 57 -IconSize 40
