const PDFDocument = require('pdfkit');

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;

const formatDonationDate = (date) => {
  return new Date(date).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

const drawBorder = (doc) => {
  doc.save();
  doc.roundedRect(24, 24, PAGE_WIDTH - 48, PAGE_HEIGHT - 48, 18).lineWidth(2.5).stroke('#b91c1c');
  doc.roundedRect(38, 38, PAGE_WIDTH - 76, PAGE_HEIGHT - 76, 14).lineWidth(1).stroke('#fecaca');
  doc.restore();
};

const drawBloodWatermark = (doc) => {
  doc.save();
  doc.fillColor('#7f1d1d').opacity(0.05);
  doc
    .path(`
      M 298 170
      C 240 245, 190 305, 190 392
      C 190 500, 272 582, 298 602
      C 324 582, 406 500, 406 392
      C 406 305, 356 245, 298 170 Z
    `)
    .fill();

  doc
    .fillColor('#b91c1c')
    .fontSize(96)
    .text('BloodLife', 0, 345, {
      width: PAGE_WIDTH,
      align: 'center'
    });
  doc.restore();
};

const drawHeader = (doc) => {
  doc.save();
  doc.roundedRect(52, 52, PAGE_WIDTH - 104, 86, 20).fill('#b91c1c');

  doc
    .fillColor('#ffffff')
    .fontSize(14)
    .font('Helvetica-Bold')
    .text('Blood Donation Portal', 0, 72, {
      width: PAGE_WIDTH,
      align: 'center'
    });

  doc
    .fontSize(30)
    .text('Certificate of Appreciation', 0, 92, {
      width: PAGE_WIDTH,
      align: 'center'
    });
  doc.restore();
};

const drawPortalStamp = (doc, centerX, centerY) => {
  doc.save();
  doc.opacity(0.92);

  // Outer scalloped seal.
  for (let index = 0; index < 24; index += 1) {
    const angle = (Math.PI * 2 * index) / 24;
    const petalX = centerX + Math.cos(angle) * 54;
    const petalY = centerY + Math.sin(angle) * 54;
    doc.circle(petalX, petalY, 9).fill('#ef4444');
  }

  doc.circle(centerX, centerY, 50).fill('#ffffff');
  doc.circle(centerX, centerY, 48).lineWidth(2).stroke('#dc2626');
  doc.circle(centerX, centerY, 35).lineWidth(2).stroke('#dc2626');

  // Center blood drop.
  doc.fillColor('#dc2626');
  doc
    .path(`
      M ${centerX} ${centerY - 22}
      C ${centerX - 16} ${centerY - 2}, ${centerX - 20} ${centerY + 18}, ${centerX} ${centerY + 28}
      C ${centerX + 20} ${centerY + 18}, ${centerX + 16} ${centerY - 2}, ${centerX} ${centerY - 22} Z
    `)
    .fill();

  doc
    .fillColor('#ffffff')
    .path(`
      M ${centerX + 6} ${centerY - 6}
      C ${centerX + 12} ${centerY + 2}, ${centerX + 10} ${centerY + 12}, ${centerX + 4} ${centerY + 18}
    `)
    .lineWidth(2)
    .stroke('#ffffff');

  // Ring text.
  doc.fillColor('#dc2626').font('Helvetica-Bold').fontSize(11);
  doc.text('BLOOD DONOR', centerX - 38, centerY - 46, {
    width: 76,
    align: 'center'
  });
  doc.text('BLOODLIFE PORTAL', centerX - 48, centerY + 34, {
    width: 96,
    align: 'center'
  });

  doc.restore();
};

exports.generateCertificate = (donorName, receiverName, date) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: 'Blood Donation Certificate',
        Author: 'BloodLife Portal'
      }
    });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawBorder(doc);
    drawBloodWatermark(doc);
    drawHeader(doc);

    doc
      .fillColor('#7f1d1d')
      .font('Helvetica-Bold')
      .fontSize(16)
      .text('Presented With Gratitude To', 0, 185, {
        width: PAGE_WIDTH,
        align: 'center'
      });

    doc
      .moveTo(180, 265)
      .lineTo(415, 265)
      .lineWidth(1)
      .strokeColor('#fca5a5')
      .stroke();

    doc
      .fillColor('#111827')
      .fontSize(28)
      .text(donorName, 0, 225, {
        width: PAGE_WIDTH,
        align: 'center'
      });

    doc
      .fillColor('#374151')
      .font('Helvetica')
      .fontSize(15)
      .text(
        `For the noble act of donating blood to ${receiverName} and supporting a life-saving moment through BloodLife Portal.`,
        92,
        300,
        {
          width: PAGE_WIDTH - 184,
          align: 'center',
          lineGap: 6
        }
      );

    doc
      .fillColor('#991b1b')
      .font('Helvetica-Bold')
      .fontSize(18)
      .text('ONE UNIT OF BLOOD', 0, 395, {
        width: PAGE_WIDTH,
        align: 'center'
      });

    doc
      .fillColor('#4b5563')
      .font('Helvetica')
      .fontSize(14)
      .text('can support hope, healing, and a second chance at life.', 0, 422, {
        width: PAGE_WIDTH,
        align: 'center'
      });

    doc
      .roundedRect(118, 482, PAGE_WIDTH - 236, 70, 16)
      .fillAndStroke('#fff7ed', '#fed7aa');

    doc
      .fillColor('#7c2d12')
      .font('Helvetica-Bold')
      .fontSize(13)
      .text('Date of Donation', 0, 500, {
        width: PAGE_WIDTH,
        align: 'center'
      });

    doc
      .fillColor('#111827')
      .fontSize(20)
      .text(formatDonationDate(date), 0, 520, {
        width: PAGE_WIDTH,
        align: 'center'
      });

    doc
      .fillColor('#6b7280')
      .font('Helvetica-Oblique')
      .fontSize(12)
      .text('Thank you for being a real-life hero and strengthening the gift of life.', 0, 590, {
        width: PAGE_WIDTH,
        align: 'center'
      });

    doc.moveTo(92, 708).lineTo(240, 708).lineWidth(1).strokeColor('#9ca3af').stroke();
    doc.moveTo(342, 708).lineTo(500, 708).lineWidth(1).strokeColor('#9ca3af').stroke();

    doc
      .fillColor('#4b5563')
      .font('Helvetica')
      .fontSize(11)
      .text('Verified Donor', 132, 714)
      .text('Authorized Signature', 374, 714);

    drawPortalStamp(doc, 420, 660);

    doc
      .fontSize(10)
      .fillColor('#6b7280')
      .text('BloodLife Portal Seal', 360, 744, {
        width: 120,
        align: 'center'
      });

    doc.end();
  });
};
