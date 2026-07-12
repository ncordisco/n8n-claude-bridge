// Copia le icone SVG (non compilate da tsc) nella cartella dist,
// mantenendo la stessa struttura di cartelle dei sorgenti.
const fs = require('fs');
const path = require('path');

function copySvgFiles(srcDir, destDir) {
    if (!fs.existsSync(srcDir)) return;
    fs.mkdirSync(destDir, {recursive: true});

    for (const entry of fs.readdirSync(srcDir, {withFileTypes: true})) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);

        if (entry.isDirectory()) {
            copySvgFiles(srcPath, destPath);
        } else if (entry.name.endsWith('.svg')) {
            fs.copyFileSync(srcPath, destPath);
            console.log(`Copiato: ${srcPath} -> ${destPath}`);
        }
    }
}

copySvgFiles(path.join(__dirname, 'nodes'), path.join(__dirname, 'dist', 'nodes'));
copySvgFiles(path.join(__dirname, 'credentials'), path.join(__dirname, 'dist', 'credentials'));
