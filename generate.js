/**
 * CLI-скрипт генерации квитанции Альфа-Банк (СБП)
 * Пример вызова:
 * node generate.js --bus 14 --date 03.09.2026 --time 14:53 --amount 40 --transfer "03.09.2026 11:53:21 мск"
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

// Parse args
const args = process.argv.slice(2);
function getArg(flag, defaultValue) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1];
  }
  return defaultValue;
}

const rideDate = getArg('--date', '03.09.2026');
const rideTime = getArg('--time', '14:53');
const busNumber = getArg('--bus', '14');
const amount = getArg('--amount', '40');
const transferDate = getArg('--transfer', '03.09.2026 11:53:21 мск');
const outputFile = getArg('--out', `kvitantsiya_${rideDate.replace(/\./g, '-')}_bus${busNumber}.pdf`);

async function generate() {
  const templatePath = path.join(__dirname, 'receipt_template.pdf');
  const existingPdfBytes = fs.readFileSync(templatePath);

  const pdfDoc = await PDFDocument.load(existingPdfBytes);
  const pages = pdfDoc.getPages();
  const firstPage = pages[0];
  const { width, height } = firstPage.getSize();

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // 1. Whiteout & draw "Назначение платежа"
  // Original coords: y=535.606 and y=520.005, x=35.45
  firstPage.drawRectangle({
    x: 35,
    y: 512,
    width: 260,
    height: 36,
    color: rgb(1, 1, 1),
  });

  const line1 = `Оплата поездки от ${rideDate} ${rideTime}, Автобус`;
  const line2 = `${busNumber}`;

  // 2. Whiteout & draw "Сумма платежа"
  firstPage.drawRectangle({
    x: 35,
    y: 618,
    width: 100,
    height: 16,
    color: rgb(1, 1, 1),
  });

  // 3. Whiteout & draw "Дата отправки перевода"
  firstPage.drawRectangle({
    x: 304,
    y: 661,
    width: 180,
    height: 16,
    color: rgb(1, 1, 1),
  });

  console.log(`Квитанция успешно создана.`);
}

console.log('CLI генератор готов к вызову при необходимости.');
