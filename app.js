const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const generateImage = require('./imageGenerator');
const fs = require('fs');
const app = express();

// Configuración de EJS como motor de vistas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Función auxiliar para generar ejemplos
function generateExamples(x, y) {
    return Array(3).fill().map(() => {
        const newY = Math.floor(Math.random() * (y + 100 - Math.max(1, y - 100)) + Math.max(1, y - 100));
        return { x, y: newY, result: (x / 100) * newY };
    });
}


// Función para generar y actualizar el sitemap.xml
function updateSitemap() {
    const db = new sqlite3.Database('./calculations.db', (err) => {
        if (err) {
            console.error("Error al conectar con la base de datos:", err);
            return;
        }

        // Paso 1: Consultar la tabla 'calculations' para obtener URLs con 'calculation_count' >= 10
        db.all("SELECT DISTINCT url FROM calculations WHERE count >= 10", (err, rows) => {
            if (err) {
                console.error("Error al consultar las URLs de la tabla 'calculations':", err);
                db.close();
                return;
            }

            // Filtrar URLs no nulas ni vacías
            const validUrls = rows
                .map(row => row.url)
                .filter(url => url && url.trim() !== '');

            // Paso 2: Vaciar la tabla 'sitemap_urls' y actualizarla con las nuevas URLs
            db.run("DELETE FROM sitemap_urls", (err) => {
                if (err) {
                    console.error("Error al vaciar la tabla 'sitemap_urls':", err);
                    db.close();
                    return;
                }

                // Preparar la inserción
                const insert = db.prepare("INSERT INTO sitemap_urls (url) VALUES (?)");
                validUrls.forEach(url => {
                    insert.run(url, (err) => {
                        if (err) {
                            console.error("Error al insertar URL en 'sitemap_urls':", err);
                        }
                    });
                });

                insert.finalize((err) => {
                    if (err) {
                        console.error("Error al finalizar la inserción en 'sitemap_urls':", err);
                        db.close();
                        return;
                    }

                    // Paso 3: Generar el archivo sitemap.xml con las URLs de la tabla 'sitemap_urls'
                    db.all("SELECT url FROM sitemap_urls", (err, rows) => {
                        if (err) {
                            console.error("Error al consultar las URLs de la tabla 'sitemap_urls':", err);
                            db.close();
                            return;
                        }

                        const urls = rows
                            .map(row => row.url)
                            .filter(url => url && url.trim() !== '');

                        const sitemapContent = `
                            <?xml version="1.0" encoding="UTF-8"?>
                            <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
                                ${urls.map(url => `
                                    <url>
                                        <loc>${url}</loc>
                                    </url>`).join('')}
                            </urlset>`;

                        fs.writeFileSync(path.join(__dirname, 'public', 'sitemap.xml'), sitemapContent.trim());
                        db.close();
                    });
                });
            });
        });
    });
}


// Ruta principal
app.get('/', (req, res) => {
    res.render('calculator');
});

// Ruta para procesar el cálculo
app.post('/calculate', (req, res) => {
    const x = parseInt(req.body.x);
    const y = parseInt(req.body.y);

    if (isNaN(x) || isNaN(y)) {
        return res.status(400).send("Parámetros inválidos");
    }

    const result = (x / 100) * y;

    const db = new sqlite3.Database('./calculations.db', (err) => {
        if (err) {
            console.error('Error al conectar con la base de datos:', err);
            return res.status(500).send("Error en el servidor");
        }

        db.serialize(() => {
            // Crear las tablas si no existen
            db.run('CREATE TABLE IF NOT EXISTS calculations (id INTEGER PRIMARY KEY AUTOINCREMENT, x INTEGER, y INTEGER, count INTEGER, last_calculated TEXT, explanation TEXT, url TEXT);');
            db.run('CREATE TABLE IF NOT EXISTS sitemap_urls (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT UNIQUE);');

            // Consultar si ya existe el cálculo en la base de datos
            db.get("SELECT * FROM calculations WHERE x = ? AND y = ?", [x, y], (err, row) => {
                if (err) {
                    console.error("Error al consultar la base de datos:", err);
                    db.close();
                    return res.status(500).send("Error en el servidor");
                }

                if (row) {
                    // Si existe, actualizar el conteo y la fecha
                    const newCount = row.count + 1;
                    let url = row.url;
                    if (newCount >= 10 && !url) {
                        url = `${req.protocol}://${req.get('host')}/${x}-por-ciento-sobre-${y}`;
                    }
                    db.run("UPDATE calculations SET count = ?, last_calculated = datetime('now'), url = ? WHERE id = ?", [newCount, url, row.id], (err) => {
                        if (err) {
                            console.error("Error al actualizar la base de datos:", err);
                            db.close();
                            return res.status(500).send("Error en el servidor");
                        }

                        if (newCount >= 10) {
                            db.run("INSERT OR IGNORE INTO sitemap_urls (url) VALUES (?)", [url], (err) => {
                                if (err) {
                                    console.error("Error al insertar la URL en el sitemap:", err);
                                    db.close();
                                    return res.status(500).send("Error en el servidor");
                                }
                                updateSitemap();
                                db.close(() => {
                                    res.redirect(`/${x}-por-ciento-sobre-${y}`);
                                });
                            });
                        } else {
                            db.close(() => {
                                res.render('result', { x, y, result, explanation: row.explanation });
                            });
                        }
                    });
                } else {
                    // Generar una nueva explicación
                    const explanation = generateExplanation(x, y);
                    const url = `${req.protocol}://${req.get('host')}/${x}-por-ciento-sobre-${y}`;

                    db.run("INSERT INTO calculations (x, y, count, last_calculated, explanation, url) VALUES (?, ?, 1, datetime('now'), ?, ?)", [x, y, explanation, url], (err) => {
                        if (err) {
                            console.error("Error al insertar en la base de datos:", err);
                            db.close();
                            return res.status(500).send("Error en el servidor");
                        }

                        db.run("INSERT OR IGNORE INTO sitemap_urls (url) VALUES (?)", [url], (err) => {
                            if (err) {
                                console.error("Error al insertar la URL en el sitemap:", err);
                                db.close();
                                return res.status(500).send("Error en el servidor");
                            }
                           
                            db.close(() => {
                                res.render('result', { x, y, result, explanation });
                            });
                        });
                    });
                }
            });
        });
    });
});

// Ruta para la página de aterrizaje
app.get('/:x-por-ciento-sobre-:y', (req, res) => {
    const x = parseInt(req.params.x);
    const y = parseInt(req.params.y);

    const db = new sqlite3.Database('./calculations.db', (err) => {
        if (err) {
            console.error("Error al conectar con la base de datos:", err);
            return res.status(500).send("Error en el servidor");
        }

        db.get("SELECT * FROM calculations WHERE x = ? AND y = ?", [x, y], (err, row) => {
            if (err) {
                console.error("Error al consultar la base de datos para la página de aterrizaje:", err);
                db.close();
                return res.status(500).send("Error en el servidor");
            }

            if (row) {
                const result = (x / 100) * y;
                const examples = generateExamples(x, y);
                const explanation = row.explanation;
                const chartTypes = ['pie', 'doughnut'];
                const chartType = chartTypes[Math.floor(Math.random() * chartTypes.length)];
                const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

                const imagePath = generateImage(x, y, result);

                res.render('landing', { x, y, result, examples, explanation, chartType, fullUrl, imagePath });
            } else {
                res.status(404).send("No se encontraron datos para esta solicitud.");
            }

            db.close();
        });
    });
});

function generateExplanation(x, y) {
    const templates = [
        `Para calcular el ${x}% de ${y}, primero necesitas convertir ${x} en un decimal dividiéndolo por 100, lo que da ${x / 100}. Luego, multiplica este valor decimal por ${y}. Esta operación te dará el resultado de cuánto es el ${x}% de ${y}. Es una manera efectiva de encontrar partes de un todo usando porcentajes. Entender cómo convertir porcentajes a decimales es fundamental para muchos cálculos matemáticos y aplicaciones financieras. Esta técnica también se puede aplicar en contextos como descuentos en compras, tasas de interés y análisis de datos, facilitando la toma de decisiones basada en porcentajes.`,
        `Calcular el ${x}% de ${y} implica determinar cuánto es ${x} partes de cada 100 partes del número ${y}. En otras palabras, multiplicas ${y} por ${x} y luego divides el resultado entre 100. Este método se basa en la comprensión de porcentajes como una proporción respecto a 100. Este cálculo no solo es útil en matemáticas, sino también en situaciones diarias como calcular impuestos, propinas y otros valores que dependen de porcentajes. La habilidad de realizar estos cálculos de manera eficiente puede mejorar tu capacidad para administrar finanzas personales y profesionales.`,
        `Para hallar el ${x}% de ${y}, piensa en dividir ${y} en 100 partes iguales y luego tomar ${x} de estas partes. Esto es equivalente a multiplicar ${y} por el decimal que representa ${x}%, el cual es ${x}/100. Este enfoque es útil para descomponer porcentajes en fracciones manejables. Utilizar esta metodología puede ayudarte a comprender mejor cómo los porcentajes afectan los totales y las fracciones en diferentes contextos, como en la educación, la ciencia y la economía.`,
        `El ${x}% de ${y} se calcula tomando ${y} y multiplicándolo por ${x} dividido entre 100. Esto te da el valor que representa ${x}% del total de ${y}. La multiplicación por la fracción decimal de ${x}% te permite encontrar directamente el valor deseado. Esta técnica es esencial en muchos campos, desde el cálculo de precios de venta hasta la estimación de crecimientos y reducciones porcentuales en estudios estadísticos y financieros.`,
        `Para calcular el ${x}% de ${y}, multiplica ${y} por ${x} y luego divide el resultado entre 100. Este proceso convierte el porcentaje ${x} en una fracción decimal que, al multiplicarse por ${y}, te da el valor exacto del ${x}% de ${y}. Es una forma directa y efectiva de usar porcentajes en cálculos. Este método es especialmente útil en situaciones cotidianas y profesionales, como la determinación de márgenes de beneficio, el análisis de rendimiento y la evaluación de cambios porcentuales en diversos datos.`,
        `Para encontrar el ${x}% de ${y}, debes convertir ${x} a su forma decimal, que es ${x}/100, y luego multiplicar este decimal por ${y}. Esta operación te dará el valor que corresponde al ${x}% de ${y}, permitiéndote entender y aplicar porcentajes en distintos contextos. Esta conversión y multiplicación son fundamentales en muchas áreas, desde la resolución de problemas matemáticos hasta la interpretación de estadísticas y la realización de cálculos financieros precisos.`,
        `Si quieres calcular el ${x}% de ${y}, multiplica ${y} por ${x} y luego divide el resultado entre 100. Este cálculo te da el valor que representa el ${x}% de ${y}. La conversión de ${x}% a un decimal y la multiplicación posterior es la clave para encontrar el porcentaje deseado. Esta técnica es ampliamente utilizada en diversas disciplinas, como la contabilidad, la economía y la investigación, donde es crucial para la precisión y la claridad en la interpretación de datos porcentuales.`,
        `El ${x}% de ${y} se puede calcular como ${x} partes de 100 del número ${y}. Multiplica ${y} por ${x} y divide el resultado entre 100 para encontrar el valor correspondiente al ${x}% de ${y}. Esta técnica convierte el porcentaje en una proporción manejable para calcular. La comprensión de cómo trabajar con porcentajes es vital en muchas situaciones, incluyendo el análisis de datos, la planificación financiera y la elaboración de informes de rendimiento.`,
        `Para hallar el ${x}% de ${y}, piensa en dividir ${y} en 100 partes iguales y luego tomar ${x} de esas partes. Es decir, multiplica ${y} por ${x}/100. Esta metodología ayuda a visualizar cómo los porcentajes representan fracciones del total, facilitando el cálculo. Esta forma de descomponer los porcentajes es útil no solo en matemáticas, sino también en situaciones prácticas como la determinación de descuentos, la evaluación de inversiones y la comprensión de estadísticas.`,
        `Si tienes ${y} y deseas calcular el ${x}%, multiplica ${y} por el decimal equivalente de ${x}%, que es ${x}/100. Esta operación te dará el valor del ${x}% de ${y}. Utilizar esta fórmula te proporciona una manera eficiente y precisa de trabajar con porcentajes. Esta técnica es esencial en muchos aspectos de la vida diaria y profesional, desde la gestión de finanzas personales hasta el análisis de tendencias y el desarrollo de estrategias basadas en datos.`,
        `El ${x}% de ${y} se obtiene tomando ${x} por cada 100 partes de ${y}. Para encontrar este valor, multiplica ${y} por ${x} y luego divide entre 100. Este cálculo convierte el porcentaje en una proporción concreta, haciendo que sea más fácil de aplicar en situaciones prácticas. Este enfoque es crucial en la resolución de problemas de porcentaje, la evaluación de descuentos y la planificación financiera a largo plazo.`,
        `Para calcular el ${x}% de ${y}, toma ${y} y multiplícalo por la fracción decimal de ${x}%, que es ${x}/100. Este método convierte el porcentaje en una fracción que se multiplica por el total, dándote el valor deseado de manera clara y precisa. Este proceso es útil en la interpretación de datos, la comparación de valores y la realización de proyecciones financieras.`,
        `El resultado del ${x}% de ${y} se puede encontrar multiplicando ${y} por ${x} dividido entre 100. Esto es porque ${x}% es equivalente a ${x}/100 como decimal. Usar esta fórmula te ayuda a calcular rápidamente el porcentaje de un número, simplificando el proceso. Este método es práctico para resolver problemas de porcentaje en contextos educativos, financieros y profesionales.`,
        `Para hallar el ${x}% de ${y}, convierte ${x} en una fracción decimal dividiéndolo entre 100 y luego multiplica por ${y}. Este proceso te da el valor que representa el ${x}% del total ${y}, ayudándote a aplicar porcentajes de manera efectiva en cálculos matemáticos. Esta técnica es esencial en muchas situaciones, desde la resolución de problemas hasta la toma de decisiones basada en datos porcentuales.`,
        `El ${x}% de ${y} se calcula utilizando la fórmula de ${x} dividido entre 100, que convierte ${x}% en decimal. Luego, multiplica este decimal por ${y} para obtener el valor exacto. Este método es ideal para aplicar porcentajes en diversas situaciones prácticas. Esta fórmula es especialmente útil en análisis de datos, gestión financiera y evaluación de rendimiento.`,
        `Para encontrar el ${x}% de ${y}, transforma ${x} en una fracción decimal (${x}/100) y multiplícalo por ${y}. Esto te dará el resultado del ${x}% de ${y}, proporcionando una forma clara de manejar cálculos de porcentajes en diferentes contextos. Este proceso es fundamental para realizar cálculos precisos y efectivos en diversas aplicaciones matemáticas y financieras.`,
        `El ${x}% de ${y} es el producto de ${y} y el valor decimal de ${x}% (${x}/100). Multiplicar ${y} por este decimal te da el valor del ${x}% de ${y}, facilitando la interpretación y aplicación de porcentajes en cálculos matemáticos. Esta técnica es crucial en la planificación y análisis de datos, así como en la toma de decisiones informadas.`,
        `Para calcular el ${x}% de ${y}, toma ${y} y multiplícalo por ${x} dividido entre 100. Esto convierte ${x}% en un decimal que se usa para encontrar el porcentaje de ${y}. Esta fórmula te proporciona un método preciso para trabajar con porcentajes. Esta metodología es ampliamente aplicable en diversas áreas, desde la resolución de problemas matemáticos hasta la interpretación de estadísticas y la gestión financiera.`,
        `El ${x}% de ${y} se obtiene calculando ${y} multiplicado por la fracción decimal de ${x}%. Para esto, divides ${x} entre 100 para obtener la fracción decimal y luego multiplicas por ${y}. Este enfoque es esencial para aplicar porcentajes en cálculos reales. Esta técnica es fundamental para la realización de cálculos precisos y efectivos en una variedad de contextos matemáticos y prácticos.`,
        `Para calcular el ${x}% de ${y}, primero convierte ${x} en un decimal dividiéndolo por 100, lo que resulta en ${x / 100}. Luego, multiplica este valor decimal por ${y}. Este proceso te dará el resultado exacto del ${x}% de ${y}. Esta operación es esencial en muchas áreas, incluyendo matemáticas, finanzas y estadística. Usar esta fórmula puede facilitar la toma de decisiones informadas y mejorar la precisión en cálculos que involucran porcentajes.`,
        `Calcular el ${x}% de ${y} implica determinar cuánto representa ${x} partes de cada 100 partes del número ${y}. Para hacer esto, multiplica ${y} por ${x} y luego divide el resultado entre 100. Este método se basa en la comprensión de porcentajes como una proporción respecto a 100. Este tipo de cálculo es común en muchos aspectos de la vida diaria, como calcular impuestos, descuentos y aumentos salariales. Dominar esta técnica puede mejorar tu capacidad para manejar situaciones financieras y analizar datos con precisión.`,
        `Para hallar el ${x}% de ${y}, imagina dividir ${y} en 100 partes iguales y luego tomar ${x} de esas partes. Esto es equivalente a multiplicar ${y} por el decimal que representa ${x}%, que es ${x}/100. Este enfoque es útil para descomponer porcentajes en fracciones manejables. Esta metodología no solo facilita la comprensión de porcentajes, sino que también es aplicable en contextos como la planificación financiera, la evaluación de descuentos y el análisis de datos.`,
        `El ${x}% de ${y} se calcula tomando ${y} y multiplicándolo por ${x} dividido entre 100. Esto te da el valor exacto que representa ${x}% del total de ${y}. Multiplicar por la fracción decimal de ${x}% es una técnica directa y efectiva para encontrar el valor deseado. Esta fórmula es esencial para la resolución de problemas matemáticos, la interpretación de datos estadísticos y la planificación financiera.`,
        `Para calcular el ${x}% de ${y}, multiplica ${y} por ${x} y luego divide el resultado entre 100. Este proceso convierte el porcentaje ${x} en una fracción decimal que, al multiplicarse por ${y}, te da el valor exacto del ${x}% de ${y}. Esta técnica es particularmente útil en la vida diaria y en contextos profesionales, como la gestión de finanzas personales, la elaboración de presupuestos y la evaluación de rendimientos.`,
        `Para encontrar el ${x}% de ${y}, debes convertir ${x} a su forma decimal, que es ${x}/100, y luego multiplicar este decimal por ${y}. Esta operación te dará el valor que corresponde al ${x}% de ${y}, permitiéndote entender y aplicar porcentajes en distintos contextos. Esta metodología es fundamental en muchos campos, incluyendo la educación, las finanzas y la investigación, donde la precisión en el cálculo de porcentajes es crucial.`,
        `Si quieres calcular el ${x}% de ${y}, multiplica ${y} por ${x} y luego divide el resultado entre 100. Este cálculo te da el valor que representa el ${x}% de ${y}. La conversión de ${x}% a un decimal y la multiplicación posterior es la clave para encontrar el porcentaje deseado. Esta técnica es esencial para muchas aplicaciones prácticas, como el análisis de datos, la planificación financiera y la evaluación de descuentos.`,
        `El ${x}% de ${y} se puede calcular como ${x} partes de 100 del número ${y}. Multiplica ${y} por ${x} y divide el resultado entre 100 para encontrar el valor correspondiente al ${x}% de ${y}. Esta técnica convierte el porcentaje en una proporción manejable para calcular. Comprender cómo trabajar con porcentajes es vital para muchas situaciones, incluyendo la evaluación de inversiones, la gestión de finanzas personales y la interpretación de estadísticas.`,
        `Para hallar el ${x}% de ${y}, piensa en dividir ${y} en 100 partes iguales y luego tomar ${x} de esas partes. Es decir, multiplica ${y} por ${x}/100. Esta metodología ayuda a visualizar cómo los porcentajes representan fracciones del total, facilitando el cálculo. Este enfoque es útil no solo en matemáticas, sino también en situaciones prácticas como la determinación de descuentos, la evaluación de inversiones y la comprensión de estadísticas.`,
        `Si tienes ${y} y deseas calcular el ${x}%, multiplica ${y} por el decimal equivalente de ${x}%, que es ${x}/100. Esta operación te dará el valor del ${x}% de ${y}. Utilizar esta fórmula te proporciona una manera eficiente y precisa de trabajar con porcentajes. Esta técnica es esencial en muchos aspectos de la vida diaria y profesional, desde la gestión de finanzas personales hasta el análisis de tendencias y el desarrollo de estrategias basadas en datos.`,
        `El ${x}% de ${y} se obtiene tomando ${x} por cada 100 partes de ${y}. Para encontrar este valor, multiplica ${y} por ${x} y luego divide entre 100. Este cálculo convierte el porcentaje en una proporción concreta, haciendo que sea más fácil de aplicar en situaciones prácticas. Este enfoque es crucial en la resolución de problemas de porcentaje, la evaluación de descuentos y la planificación financiera a largo plazo.`,
        `Para calcular el ${x}% de ${y}, toma ${y} y multiplícalo por la fracción decimal de ${x}%, que es ${x}/100. Este método convierte el porcentaje en una fracción que se multiplica por el total, dándote el valor deseado de manera clara y precisa. Este proceso es útil en la interpretación de datos, la comparación de valores y la realización de proyecciones financieras.`,
        `El resultado del ${x}% de ${y} se puede encontrar multiplicando ${y} por ${x} dividido entre 100. Esto es porque ${x}% es equivalente a ${x}/100 como decimal. Usar esta fórmula te ayuda a calcular rápidamente el porcentaje de un número, simplificando el proceso. Este método es práctico para resolver problemas de porcentaje en contextos educativos, financieros y profesionales.`,
        `Para hallar el ${x}% de ${y}, convierte ${x} en una fracción decimal dividiéndolo entre 100 y luego multiplica por ${y}. Este proceso te da el valor que representa el ${x}% del total ${y}, ayudándote a aplicar porcentajes de manera efectiva en cálculos matemáticos. Esta técnica es esencial en muchas situaciones, desde la resolución de problemas hasta la toma de decisiones basada en datos porcentuales.`,
        `El ${x}% de ${y} se calcula utilizando la fórmula de ${x} dividido entre 100, que convierte ${x}% en decimal. Luego, multiplica este decimal por ${y} para obtener el valor exacto. Este método es ideal para aplicar porcentajes en diversas situaciones prácticas. Esta fórmula es especialmente útil en análisis de datos, gestión financiera y evaluación de rendimiento.`,
        `Para encontrar el ${x}% de ${y}, transforma ${x} en una fracción decimal (${x}/100) y multiplícalo por ${y}. Esto te dará el resultado del ${x}% de ${y}, proporcionando una forma clara de manejar cálculos de porcentajes en diferentes contextos. Este proceso es fundamental para realizar cálculos precisos y efectivos en diversas aplicaciones matemáticas y financieras.`,
        `El ${x}% de ${y} es el producto de ${y} y el valor decimal de ${x}% (${x}/100). Multiplicar ${y} por este decimal te da el valor del ${x}% de ${y}, facilitando la interpretación y aplicación de porcentajes en cálculos matemáticos. Esta técnica es crucial en la planificación y análisis de datos, así como en la toma de decisiones informadas.`,
        `Para calcular el ${x}% de ${y}, toma ${y} y multiplícalo por ${x} dividido entre 100. Esto convierte ${x}% en un decimal que se usa para encontrar el porcentaje de ${y}. Esta fórmula te proporciona un método preciso para trabajar con porcentajes. Esta metodología es ampliamente aplicable en diversas áreas, desde la resolución de problemas matemáticos hasta la interpretación de estadísticas y la gestión financiera.`,
        `El ${x}% de ${y} se obtiene calculando ${y} multiplicado por la fracción decimal de ${x}%. Para esto, divides ${x} entre 100 para obtener la fracción decimal y luego multiplicas por ${y}. Este enfoque es esencial para aplicar porcentajes en cálculos reales. Esta técnica es fundamental para la realización de cálculos precisos y efectivos en una variedad de contextos matemáticos y prácticos.`,
        `Para calcular el ${x}% de ${y}, sigue estos pasos:
        <ol>
        <li>Divide ${x} entre 100 para convertir el porcentaje en decimal.</li>
        <li>Multiplica el resultado por ${y}.</li>
        <li>El resultado es el valor que representa el ${x}% de ${y}.</li>
        </ol>
        Esta técnica paso a paso asegura una comprensión clara y precisa del cálculo de porcentajes, útil en situaciones académicas y prácticas.`,
        
        `Imagina que tienes ${y} y quieres encontrar el ${x}% de este valor. Para hacerlo:
        <ul>
        <li>- Primero, convierte ${x} en su forma decimal dividiéndolo entre 100.</li>
        <li>- Luego, multiplica este decimal por ${y}.</li>
        <li>- El resultado es el ${x}% de ${y}.</li>
        </ul>
        Esta fórmula es esencial para cálculos precisos en finanzas y estadísticas.`,
        
        `Para determinar cuánto es el ${x}% de ${y}, puedes pensar en porcentajes como fracciones:
        <ul>
        <li>- Divide ${x} entre 100 para obtener el decimal correspondiente.</li>
        <li>- Multiplica este decimal por ${y}.</li>
        <li>- Así obtendrás el valor exacto del ${x}% de ${y}.</li>
        </ul>
        Esta técnica es especialmente útil en cálculos de descuentos y análisis financieros.`,
        
        `Supongamos que necesitas calcular el ${x}% de ${y}. Para hacerlo:
        <ol>
        <li>Convierte ${x} a un decimal dividiéndolo entre 100.</li>
        <li>Multiplica el decimal resultante por ${y}.</li>
        <li>Obtendrás el valor que representa el ${x}% de ${y}.</li>
        </ol>
        Este método es muy útil en matemáticas financieras y en la vida cotidiana para gestionar presupuestos y entender estadísticas.`,
        
        `Para hallar el ${x}% de ${y}, considera lo siguiente:
          <ul>
        <li>- El porcentaje ${x}% se puede expresar como ${x}/100.</li>
        <li>- Multiplica ${y} por esta fracción.</li>
        <li>- El resultado será el ${x}% de ${y}.</li>
        </ul>
        Este enfoque es fundamental para resolver problemas de porcentaje en diversos contextos, desde la educación hasta la economía.`,
        
        `Para encontrar el ${x}% de ${y}, realiza estos pasos:
        <ul>
        <li>- Convierte ${x}% a su forma decimal dividiéndolo entre 100.</li>
        <li>- Multiplica el decimal por ${y}.</li>
        <li>- El resultado será el valor del ${x}% de ${y}.</li>
        </ul>
        Este proceso es esencial en la toma de decisiones financieras y en la interpretación de datos porcentuales.`,
        
        `Si necesitas calcular el ${x}% de ${y}, sigue estos pasos:
        <ol>
        <li>Divide ${x} entre 100 para convertir el porcentaje a un decimal.</li>
        <li>Multiplica el decimal por ${y}.</li>
        <li>Obtén el valor que corresponde al ${x}% de ${y}.</li>
        </ol>
        Este método es crucial para entender cómo los porcentajes afectan los valores totales en diversos contextos, como el análisis de inversiones y la planificación financiera.`,
        
        `Para determinar el ${x}% de ${y}, piensa en lo siguiente:
        <ul>
        <li>Divide ${x} entre 100 para obtener el decimal.</li>
        <li>Multiplica el decimal por ${y}.</li>
        <li>El resultado será el ${x}% de ${y}.</li>
        </ul>
        Esta técnica es útil para calcular rápidamente porcentajes en situaciones prácticas, como la aplicación de descuentos y la evaluación de rendimientos.`,
        
        `Calcular el ${x}% de ${y} implica:
        <ul>
        <li>Convertir ${x} en un decimal dividiéndolo entre 100.</li>
        <li>Multiplicar este decimal por ${y}.</li>
        <li>Obtener el valor del ${x}% de ${y}.</li>
        </ul>
        Esta fórmula es esencial en la resolución de problemas de porcentaje y en la interpretación de datos financieros y estadísticos.`,
        
        `Para encontrar el ${x}% de ${y}, sigue estos pasos:
        <ol>
        <li>Convierte ${x} a su forma decimal dividiéndolo entre 100.</li>
        <li>Multiplica el decimal por ${y}.</li>
        <li>Obtén el valor que representa el ${x}% de ${y}.</li>
        </ol>
        Esta metodología es crucial para realizar cálculos precisos en matemáticas, finanzas y estadísticas, y para comprender cómo los porcentajes afectan diferentes valores.`
    ];

    return templates[Math.floor(Math.random() * templates.length)];
}

// Iniciar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

/* const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const generateImage = require('./imageGenerator');
const app = express();

// Configuración de EJS como motor de vistas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Función auxiliar para generar ejemplos
function generateExamples(x, y) {
    return Array(3).fill().map(() => {
        const newY = Math.floor(Math.random() * (y + 100 - Math.max(1, y - 100)) + Math.max(1, y - 100));
        return { x, y: newY, result: (x / 100) * newY };
    });
}


// Función para generar y actualizar el sitemap.xml
function updateSitemap() {
    const db = new sqlite3.Database('./calculations.db', (err) => {
        if (err) {
            console.error("Error al conectar con la base de datos:", err);
            return;
        }

        db.all("SELECT url FROM sitemap_urls", (err, rows) => {
            if (err) {
                console.error("Error al consultar las URLs del sitemap:", err);
                db.close();
                return;
            }

            const urls = rows.map(row => row.url);

            const sitemapContent = `
                <?xml version="1.0" encoding="UTF-8"?>
                <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
                    ${urls.map(url => `
                        <url>
                            <loc>${url}</loc>
                        </url>`).join('')}
                </urlset>`;

            fs.writeFileSync(path.join(__dirname, 'public', 'sitemap.xml'), sitemapContent.trim());
            db.close();
        });
    });
}


// Ruta principal
app.get('/', (req, res) => {
    res.render('calculator');
});

// Ruta para procesar el cálculo
app.post('/calculate', (req, res) => {
    const x = parseInt(req.body.x);
    const y = parseInt(req.body.y);

    if (isNaN(x) || isNaN(y)) {
        return res.status(400).send("Parámetros inválidos");
    }

    const result = (x / 100) * y;

    const db = new sqlite3.Database('./calculations.db', (err) => {
        if (err) {
            console.error('Error al conectar con la base de datos:', err);
            return res.status(500).send("Error en el servidor");
        }

        db.serialize(() => {
            // Crear la tabla si no existe
            db.run('CREATE TABLE IF NOT EXISTS calculations (id INTEGER PRIMARY KEY AUTOINCREMENT, x INTEGER, y INTEGER, count INTEGER, last_calculated TEXT, explanation TEXT, url TEXT);');
            db.run('CREATE TABLE IF NOT EXISTS sitemap_urls (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT UNIQUE);');

            // Consultar si ya existe el cálculo en la base de datos
            db.get("SELECT * FROM calculations WHERE x = ? AND y = ?", [x, y], (err, row) => {
                if (err) {
                    console.error("Error al consultar la base de datos:", err);
                    db.close();
                    return res.status(500).send("Error en el servidor");
                }

                if (row) {
                    // Si existe, actualizar el conteo y la fecha
                    const newCount = row.count + 1;
                    let url = row.url;
                    if (newCount >= 10 && !url) {
                        url = `${req.protocol}://${req.get('host')}/${x}-por-ciento-sobre-${y}`;
                    }
                    db.run("UPDATE calculations SET count = ?, last_calculated = datetime('now'), url = ? WHERE id = ?", [newCount, url, row.id], (err) => {
                        if (err) {
                            console.error("Error al actualizar la base de datos:", err);
                            db.close();
                            return res.status(500).send("Error en el servidor");
                        }

                        // Si el conteo alcanza 10, redirigir a una nueva URL
                        if (newCount >= 10) {
                            db.close(() => {
                                res.redirect(`/${x}-por-ciento-sobre-${y}`);
                            });
                        } else {
                            // Mostrar el resultado en pantalla si el conteo es menor a 10
                            db.close(() => {
                                res.render('result', { x, y, result, explanation: row.explanation });
                            });
                        }
                    });
                } else {
                    // Generar una nueva explicación
                    const explanation = generateExplanation(x, y);
                    const url = `${req.protocol}://${req.get('host')}/${x}-por-ciento-sobre-${y}`;

                    // Insertar el nuevo cálculo
                    db.run("INSERT INTO calculations (x, y, count, last_calculated, explanation, url) VALUES (?, ?, 1, datetime('now'), ?, ?)", [x, y, explanation, url], (err) => {
                        if (err) {
                            console.error("Error al insertar en la base de datos:", err);
                            db.close();
                            return res.status(500).send("Error en el servidor");
                        }

                        // Mostrar el resultado en pantalla
                        db.close(() => {
                            res.render('result', { x, y, result, explanation });
                        });
                    });
                }
            });
        });
    });
});

// Ruta para la página de aterrizaje
app.get('/:x-por-ciento-sobre-:y', (req, res) => {
    const x = parseInt(req.params.x);
    const y = parseInt(req.params.y);

    const db = new sqlite3.Database('./calculations.db', (err) => {
        if (err) {
            console.error("Error al conectar con la base de datos:", err);
            return res.status(500).send("Error en el servidor");
        }

        db.get("SELECT * FROM calculations WHERE x = ? AND y = ?", [x, y], (err, row) => {
            if (err) {
                console.error("Error al consultar la base de datos para la página de aterrizaje:", err);
                db.close();
                return res.status(500).send("Error en el servidor");
            }

            if (row) {
                const result = (x / 100) * y;
                const examples = generateExamples(x, y);
                const explanation = row.explanation;
                const chartTypes = ['pie', 'doughnut'];
                const chartType = chartTypes[Math.floor(Math.random() * chartTypes.length)];
                const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

                // Generar la imagen destacada
                const imagePath = generateImage(x, y, result);

                res.render('landing', { x, y, result, examples, explanation, chartType, fullUrl, imagePath });
            } else {
                res.status(404).send("No se encontraron datos para esta solicitud.");
            }

            db.close();
        });
    });
});

// Función para generar la explicación
function generateExplanation(x, y) {
    const templates = [
        `Para calcular el ${x}% de ${y}, primero necesitas convertir ${x} en un decimal dividiéndolo por 100, lo que da ${x / 100}. Luego, multiplica este valor decimal por ${y}. Esta operación te dará el resultado de cuánto es el ${x}% de ${y}. Es una manera efectiva de encontrar partes de un todo usando porcentajes.`,
        // otros templates
    ];

    return templates[Math.floor(Math.random() * templates.length)];
}

// Iniciar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    updateSitemap(); // Generar el sitemap.xml inicial
});
*/
/*

const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const generateImage = require('./imageGenerator');
const app = express();

// Configuración de EJS como motor de vistas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Función auxiliar para generar ejemplos
function generateExamples(x, y) {
    return Array(3).fill().map(() => {
        const newY = Math.floor(Math.random() * (y + 100 - Math.max(1, y - 100)) + Math.max(1, y - 100));
        return { x, y: newY, result: (x / 100) * newY };
    });
}

// Ruta principal
app.get('/', (req, res) => {
    res.render('calculator');
});

// Ruta para procesar el cálculo
app.post('/calculate', (req, res) => {
    const x = parseInt(req.body.x);
    const y = parseInt(req.body.y);

    if (isNaN(x) || isNaN(y)) {
        return res.status(400).send("Parámetros inválidos");
    }

    const result = (x / 100) * y;

    const db = new sqlite3.Database('./calculations.db', (err) => {
        if (err) {
            console.error('Error al conectar con la base de datos:', err);
            return res.status(500).send("Error en el servidor");
        }

        db.serialize(() => {
            // Crear la tabla si no existe
            db.run('CREATE TABLE IF NOT EXISTS calculations (id INTEGER PRIMARY KEY AUTOINCREMENT, x INTEGER, y INTEGER, count INTEGER, last_calculated TEXT, explanation TEXT, url TEXT);');

            // Consultar si ya existe el cálculo en la base de datos
            db.get("SELECT * FROM calculations WHERE x = ? AND y = ?", [x, y], (err, row) => {
                if (err) {
                    console.error("Error al consultar la base de datos:", err);
                    db.close();
                    return res.status(500).send("Error en el servidor");
                }

                // Generar una nueva explicación
                const explanation = generateExplanation(x, y);

                if (row) {
                    // Si existe, actualizar el conteo y la explicación
                    const newCount = row.count + 1;
                    let url = row.url;
                    if (newCount >= 10 && !url) {
                        url = `${req.protocol}://${req.get('host')}/${x}-por-ciento-sobre-${y}`;
                    }
                    db.run("UPDATE calculations SET count = ?, last_calculated = datetime('now'), explanation = ?, url = ? WHERE id = ?", [newCount, explanation, url, row.id], (err) => {
                        if (err) {
                            console.error("Error al actualizar la base de datos:", err);
                            db.close();
                            return res.status(500).send("Error en el servidor");
                        }

                        // Si el conteo alcanza 10, redirigir a una nueva URL
                        if (newCount >= 10) {
                            db.close(() => {
                                res.redirect(`/${x}-por-ciento-sobre-${y}`);
                            });
                        } else {
                            // Mostrar el resultado en pantalla si el conteo es menor a 10
                            db.close(() => {
                                res.render('result', { x, y, result, explanation });
                            });
                        }
                    });
                } else {
                    const url = `${req.protocol}://${req.get('host')}/${x}-por-ciento-sobre-${y}`;
                    // Si no existe, insertar el nuevo cálculo
                    db.run("INSERT INTO calculations (x, y, count, last_calculated, explanation, url) VALUES (?, ?, 1, datetime('now'), ?, ?)", [x, y, explanation, url], (err) => {
                        if (err) {
                            console.error("Error al insertar en la base de datos:", err);
                            db.close();
                            return res.status(500).send("Error en el servidor");
                        }

                        // Mostrar el resultado en pantalla si el conteo es menor a 10
                        db.close(() => {
                            res.render('result', { x, y, result, explanation });
                        });
                    });
                }
            });
        });
    });
});

// Ruta para la página de aterrizaje
app.get('/:x-por-ciento-sobre-:y', (req, res) => {
    const x = parseInt(req.params.x);
    const y = parseInt(req.params.y);

    const db = new sqlite3.Database('./calculations.db', (err) => {
        if (err) {
            console.error("Error al conectar con la base de datos:", err);
            return res.status(500).send("Error en el servidor");
        }

        db.get("SELECT * FROM calculations WHERE x = ? AND y = ?", [x, y], (err, row) => {
            if (err) {
                console.error("Error al consultar la base de datos para la página de aterrizaje:", err);
                db.close();
                return res.status(500).send("Error en el servidor");
            }

            if (row) {
                const result = (x / 100) * y;
                const examples = generateExamples(x, y);
                const explanation = row.explanation;
                const chartTypes = ['pie', 'doughnut'];
                const chartType = chartTypes[Math.floor(Math.random() * chartTypes.length)];
                const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  
                // Generar la imagen destacada
                const imagePath = generateImage(x, y, result);

                res.render('landing', { x, y, result, examples, explanation, chartType, fullUrl, imagePath });
            } else {
                res.status(404).send("No se encontraron datos para esta solicitud.");
            }

            db.close();
        });
    });
});


// Función para generar la explicación
function generateExplanation(x, y) {
    const templates = [
        `Para calcular el ${x}% de ${y}, primero necesitas convertir ${x} en un decimal dividiéndolo por 100, lo que da ${x / 100}. Luego, multiplica este valor decimal por ${y}. Esta operación te dará el resultado de cuánto es el ${x}% de ${y}. Es una manera efectiva de encontrar partes de un todo usando porcentajes.`,
        `Calcular el ${x}% de ${y} implica determinar cuánto es ${x} partes de cada 100 partes del número ${y}. En otras palabras, multiplicas ${y} por ${x} y luego divides el resultado entre 100. Este método se basa en la comprensión de porcentajes como una proporción respecto a 100.`,
        `Para hallar el ${x}% de ${y}, piensa en dividir ${y} en 100 partes iguales y luego tomar ${x} de estas partes. Esto es equivalente a multiplicar ${y} por el decimal que representa ${x}%, el cual es ${x}/100. Este enfoque es útil para descomponer porcentajes en fracciones manejables.`,
        `El ${x}% de ${y} se calcula tomando ${y} y multiplicándolo por ${x} dividido entre 100. Esto te da el valor que representa ${x}% del total de ${y}. La multiplicación por la fracción decimal de ${x}% te permite encontrar directamente el valor deseado.`,
        `Para calcular el ${x}% de ${y}, multiplica ${y} por ${x} y luego divide el resultado entre 100. Este proceso convierte el porcentaje ${x} en una fracción decimal que, al multiplicarse por ${y}, te da el valor exacto del ${x}% de ${y}. Es una forma directa y efectiva de usar porcentajes en cálculos.`,
        `Para encontrar el ${x}% de ${y}, debes convertir ${x} a su forma decimal, que es ${x}/100, y luego multiplicar este decimal por ${y}. Esta operación te dará el valor que corresponde al ${x}% de ${y}, permitiéndote entender y aplicar porcentajes en distintos contextos.`,
        `Si quieres calcular el ${x}% de ${y}, multiplica ${y} por ${x} y luego divide el resultado entre 100. Este cálculo te da el valor que representa el ${x}% de ${y}. La conversión de ${x}% a un decimal y la multiplicación posterior es la clave para encontrar el porcentaje deseado.`,
        `El ${x}% de ${y} se puede calcular como ${x} partes de 100 del número ${y}. Multiplica ${y} por ${x} y divide el resultado entre 100 para encontrar el valor correspondiente al ${x}% de ${y}. Esta técnica convierte el porcentaje en una proporción manejable para calcular.`,
        `Para hallar el ${x}% de ${y}, piensa en dividir ${y} en 100 partes iguales y luego tomar ${x} de esas partes. Es decir, multiplica ${y} por ${x}/100. Esta metodología ayuda a visualizar cómo los porcentajes representan fracciones del total, facilitando el cálculo.`,
        `Si tienes ${y} y deseas calcular el ${x}%, multiplica ${y} por el decimal equivalente de ${x}%, que es ${x}/100. Esta operación te dará el valor del ${x}% de ${y}. Utilizar esta fórmula te proporciona una manera eficiente y precisa de trabajar con porcentajes.`,
        `El ${x}% de ${y} se obtiene tomando ${x} por cada 100 partes de ${y}. Para encontrar este valor, multiplica ${y} por ${x} y luego divide entre 100. Este cálculo convierte el porcentaje en una proporción concreta, haciendo que sea más fácil de aplicar en situaciones prácticas.`,
        `Para calcular el ${x}% de ${y}, toma ${y} y multiplícalo por la fracción decimal de ${x}%, que es ${x}/100. Este método convierte el porcentaje en una fracción que se multiplica por el total, dándote el valor deseado de manera clara y precisa.`,
        `El resultado del ${x}% de ${y} se puede encontrar multiplicando ${y} por ${x} dividido entre 100. Esto es porque ${x}% es equivalente a ${x}/100 como decimal. Usar esta fórmula te ayuda a calcular rápidamente el porcentaje de un número, simplificando el proceso.`,
        `Para hallar el ${x}% de ${y}, convierte ${x} en una fracción decimal dividiéndolo entre 100 y luego multiplica por ${y}. Este proceso te da el valor que representa el ${x}% del total ${y}, ayudándote a aplicar porcentajes de manera efectiva en cálculos matemáticos.`,
        `El ${x}% de ${y} se calcula utilizando la fórmula de ${x} dividido entre 100, que convierte ${x}% en decimal. Luego, multiplica este decimal por ${y} para obtener el valor exacto. Este método es ideal para aplicar porcentajes en diversas situaciones prácticas.`,
        `Para encontrar el ${x}% de ${y}, transforma ${x} en una fracción decimal (${x}/100) y multiplícalo por ${y}. Esto te dará el resultado del ${x}% de ${y}, proporcionando una forma clara de manejar cálculos de porcentajes en diferentes contextos.`,
        `El ${x}% de ${y} es el producto de ${y} y el valor decimal de ${x}% (${x}/100). Multiplicar ${y} por este decimal te da el valor del ${x}% de ${y}, facilitando la interpretación y aplicación de porcentajes en cálculos matemáticos.`,
        `Para calcular el ${x}% de ${y}, toma ${y} y multiplícalo por ${x} dividido entre 100. Esto convierte ${x}% en un decimal que se usa para encontrar el porcentaje de ${y}. Esta fórmula te proporciona un método preciso para trabajar con porcentajes.`,
        `El ${x}% de ${y} se obtiene calculando ${y} multiplicado por la fracción decimal de ${x}%. Para esto, divides ${x} entre 100 para obtener la fracción decimal y luego multiplicas por ${y}. Este enfoque es esencial para aplicar porcentajes en cálculos reales.`
    ];

    return templates[Math.floor(Math.random() * templates.length)];
}

// Iniciar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));

/*
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const generateImage = require('./imageGenerator');
const app = express();

// Configuración de EJS como motor de vistas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Función auxiliar para generar ejemplos
function generateExamples(x, y) {
    return Array(3).fill().map(() => {
        const newY = Math.floor(Math.random() * (y + 100 - Math.max(1, y - 100)) + Math.max(1, y - 100));
        return { x, y: newY, result: (x / 100) * newY };
    });
}

// Ruta principal
app.get('/', (req, res) => {
    res.render('calculator');
});

// Ruta para procesar el cálculo
app.post('/calculate', (req, res) => {
    const x = parseInt(req.body.x);
    const y = parseInt(req.body.y);

    if (isNaN(x) || isNaN(y)) {
        return res.status(400).send("Parámetros inválidos");
    }

    const result = (x / 100) * y;

    const db = new sqlite3.Database('./calculations.db', (err) => {
        if (err) {
            console.error('Error al conectar con la base de datos:', err);
            return res.status(500).send("Error en el servidor");
        }

        db.serialize(() => {
            // Crear la tabla si no existe
            db.run('CREATE TABLE IF NOT EXISTS calculations (id INTEGER PRIMARY KEY AUTOINCREMENT, x INTEGER, y INTEGER, count INTEGER, last_calculated TEXT, explanation TEXT);');

            // Consultar si ya existe el cálculo en la base de datos
            db.get("SELECT * FROM calculations WHERE x = ? AND y = ?", [x, y], (err, row) => {
                if (err) {
                    console.error("Error al consultar la base de datos:", err);
                    db.close();
                    return res.status(500).send("Error en el servidor");
                }

                // Generar una nueva explicación
                const explanation = generateExplanation(x, y);

                if (row) {
                    // Si existe, actualizar el conteo y la explicación
                    const newCount = row.count + 1;
                    db.run("UPDATE calculations SET count = ?, last_calculated = datetime('now'), explanation = ? WHERE id = ?", [newCount, explanation, row.id], (err) => {
                        if (err) {
                            console.error("Error al actualizar la base de datos:", err);
                            db.close();
                            return res.status(500).send("Error en el servidor");
                        }

                        // Si el conteo alcanza 10, redirigir a una nueva URL
                        if (newCount >= 10) {
                            const urlSuffix = `${x}-por-ciento-sobre-${y}`;
                            db.close(() => {
                                res.redirect(`/${urlSuffix}`);
                            });
                        } else {
                            // Mostrar el resultado en pantalla si el conteo es menor a 10
                            db.close(() => {
                                res.render('result', { x, y, result, explanation });
                            });
                        }
                    });
                } else {
                    // Si no existe, insertar el nuevo cálculo
                    db.run("INSERT INTO calculations (x, y, count, last_calculated, explanation) VALUES (?, ?, 1, datetime('now'), ?)", [x, y, explanation], (err) => {
                        if (err) {
                            console.error("Error al insertar en la base de datos:", err);
                            db.close();
                            return res.status(500).send("Error en el servidor");
                        }

                        // Mostrar el resultado en pantalla si el conteo es menor a 10
                        db.close(() => {
                            res.render('result', { x, y, result, explanation });
                        });
                    });
                }
            });
        });
    });
});


// Ruta para la página de aterrizaje
app.get('/:x-por-ciento-sobre-:y', (req, res) => {
    const x = parseInt(req.params.x);
    const y = parseInt(req.params.y);

    const db = new sqlite3.Database('./calculations.db', (err) => {
        if (err) {
            console.error("Error al conectar con la base de datos:", err);
            return res.status(500).send("Error en el servidor");
        }

        db.get("SELECT * FROM calculations WHERE x = ? AND y = ?", [x, y], (err, row) => {
            if (err) {
                console.error("Error al consultar la base de datos para la página de aterrizaje:", err);
                db.close();
                return res.status(500).send("Error en el servidor");
            }

            if (row) {
                const result = (x / 100) * y;
                const examples = generateExamples(x, y);
                const explanation = row.explanation;
                const chartTypes = ['pie', 'doughnut'];
                const chartType = chartTypes[Math.floor(Math.random() * chartTypes.length)];
                const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  
              // Generar la imagen destacada
              const imagePath = generateImage(x, y, result);

              res.render('landing', { x, y, result, examples, explanation, chartType, fullUrl,imagePath  });
            } else {
                res.status(404).send("No se encontraron datos para esta solicitud.");
            }

            db.close();
        });
    });
});





function generateExplanation(x, y) {
    const templates = [
        `Para calcular el ${x}% de ${y}, primero necesitas convertir ${x} en un decimal dividiéndolo por 100, lo que da ${x / 100}. Luego, multiplica este valor decimal por ${y}. Esta operación te dará el resultado de cuánto es el ${x}% de ${y}. Es una manera efectiva de encontrar partes de un todo usando porcentajes.`,
        `Calcular el ${x}% de ${y} implica determinar cuánto es ${x} partes de cada 100 partes del número ${y}. En otras palabras, multiplicas ${y} por ${x} y luego divides el resultado entre 100. Este método se basa en la comprensión de porcentajes como una proporción respecto a 100.`,
        `Para hallar el ${x}% de ${y}, piensa en dividir ${y} en 100 partes iguales y luego tomar ${x} de estas partes. Esto es equivalente a multiplicar ${y} por el decimal que representa ${x}%, el cual es ${x}/100. Este enfoque es útil para descomponer porcentajes en fracciones manejables.`,
        `El ${x}% de ${y} se calcula tomando ${y} y multiplicándolo por ${x} dividido entre 100. Esto te da el valor que representa ${x}% del total de ${y}. La multiplicación por la fracción decimal de ${x}% te permite encontrar directamente el valor deseado.`,
        `Para calcular el ${x}% de ${y}, multiplica ${y} por ${x} y luego divide el resultado entre 100. Este proceso convierte el porcentaje ${x} en una fracción decimal que, al multiplicarse por ${y}, te da el valor exacto del ${x}% de ${y}. Es una forma directa y efectiva de usar porcentajes en cálculos.`,
        `Para encontrar el ${x}% de ${y}, debes convertir ${x} a su forma decimal, que es ${x}/100, y luego multiplicar este decimal por ${y}. Esta operación te dará el valor que corresponde al ${x}% de ${y}, permitiéndote entender y aplicar porcentajes en distintos contextos.`,
        `Si quieres calcular el ${x}% de ${y}, multiplica ${y} por ${x} y luego divide el resultado entre 100. Este cálculo te da el valor que representa el ${x}% de ${y}. La conversión de ${x}% a un decimal y la multiplicación posterior es la clave para encontrar el porcentaje deseado.`,
        `El ${x}% de ${y} se puede calcular como ${x} partes de 100 del número ${y}. Multiplica ${y} por ${x} y divide el resultado entre 100 para encontrar el valor correspondiente al ${x}% de ${y}. Esta técnica convierte el porcentaje en una proporción manejable para calcular.`,
        `Para hallar el ${x}% de ${y}, piensa en dividir ${y} en 100 partes iguales y luego tomar ${x} de esas partes. Es decir, multiplica ${y} por ${x}/100. Esta metodología ayuda a visualizar cómo los porcentajes representan fracciones del total, facilitando el cálculo.`,
        `Si tienes ${y} y deseas calcular el ${x}%, multiplica ${y} por el decimal equivalente de ${x}%, que es ${x}/100. Esta operación te dará el valor del ${x}% de ${y}. Utilizar esta fórmula te proporciona una manera eficiente y precisa de trabajar con porcentajes.`,
        `El ${x}% de ${y} se obtiene tomando ${x} por cada 100 partes de ${y}. Para encontrar este valor, multiplica ${y} por ${x} y luego divide entre 100. Este cálculo convierte el porcentaje en una proporción concreta, haciendo que sea más fácil de aplicar en situaciones prácticas.`,
        `Para calcular el ${x}% de ${y}, toma ${y} y multiplícalo por la fracción decimal de ${x}%, que es ${x}/100. Este método convierte el porcentaje en una fracción que se multiplica por el total, dándote el valor deseado de manera clara y precisa.`,
        `El resultado del ${x}% de ${y} se puede encontrar multiplicando ${y} por ${x} dividido entre 100. Esto es porque ${x}% es equivalente a ${x}/100 como decimal. Usar esta fórmula te ayuda a calcular rápidamente el porcentaje de un número, simplificando el proceso.`,
        `Para hallar el ${x}% de ${y}, convierte ${x} en una fracción decimal dividiéndolo entre 100 y luego multiplica por ${y}. Este proceso te da el valor que representa el ${x}% del total ${y}, ayudándote a aplicar porcentajes de manera efectiva en cálculos matemáticos.`,
        `El ${x}% de ${y} se calcula utilizando la fórmula de ${x} dividido entre 100, que convierte ${x}% en decimal. Luego, multiplica este decimal por ${y} para obtener el valor exacto. Este método es ideal para aplicar porcentajes en diversas situaciones prácticas.`,
        `Para encontrar el ${x}% de ${y}, transforma ${x} en una fracción decimal (${x}/100) y multiplícalo por ${y}. Esto te dará el resultado del ${x}% de ${y}, proporcionando una forma clara de manejar cálculos de porcentajes en diferentes contextos.`,
        `El ${x}% de ${y} es el producto de ${y} y el valor decimal de ${x}% (${x}/100). Multiplicar ${y} por este decimal te da el valor del ${x}% de ${y}, facilitando la interpretación y aplicación de porcentajes en cálculos matemáticos.`,
        `Para calcular el ${x}% de ${y}, toma ${y} y multiplícalo por ${x} dividido entre 100. Esto convierte ${x}% en un decimal que se usa para encontrar el porcentaje de ${y}. Esta fórmula te proporciona un método preciso para trabajar con porcentajes.`,
        `El ${x}% de ${y} se obtiene calculando ${y} multiplicado por la fracción decimal de ${x}%. Para esto, divides ${x} entre 100 para obtener la fracción decimal y luego multiplicas por ${y}. Este enfoque es esencial para aplicar porcentajes en cálculos reales.`
    ];

    return templates[Math.floor(Math.random() * templates.length)];
}

// Iniciar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
*/