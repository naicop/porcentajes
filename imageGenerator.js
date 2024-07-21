const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

function generateImage(x, y, result) {
    const fileName = `result_${x}_${y}.png`;
    const filePath = path.join(__dirname, 'public', 'images', fileName);

    // Verificar si la imagen ya existe
    if (fs.existsSync(filePath)) {
        return `/images/${fileName}`;
    }

    const width = 1200;
    const height = 600;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Fondo
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);


    /*
    // Create gradient
    let gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "red");
    gradient.addColorStop(1, "blue");
    // Fill rectangle with gradient
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
*/


   // Create radial gradient
   let gradient = ctx.createRadialGradient(
    width / 2, height / 2, 0, // Coordenadas y radio del inicio del gradiente
    width / 2, height / 2, width / 2 // Coordenadas y radio del final del gradiente
);
gradient.addColorStop(0, "darkblue");
gradient.addColorStop(1, "lightgreen");

// Fill rectangle with gradient
ctx.fillStyle = gradient;
ctx.fillRect(0, 0, width, height);

   // Texto principal
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 90px Antonio';
    ctx.textAlign = 'center';
    ctx.fillText(`¿Cuánto es el ${x}% de ${y}?`, width / 2, height / 2 - 100);

    // Resultado
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 120px Antonio';
    ctx.fillText(`${result}`, width / 2, height / 2 + 100);

    // Guardar la imagen
    const out = fs.createWriteStream(filePath);
    const stream = canvas.createPNGStream();
    stream.pipe(out);
    out.on('finish', () => console.log('La imagen se ha guardado:', filePath));
    
    return `/images/${fileName}`;
}

module.exports = generateImage;