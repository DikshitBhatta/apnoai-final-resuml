// PDF text extraction with pdf.js, loaded from the CDN on first use.

const PDFJS_VERSION = '4.10.38';
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

let pdfjsPromise = null;

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(`${PDFJS_BASE}/pdf.min.mjs`).then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
      return pdfjs;
    }).catch(err => {
      pdfjsPromise = null;
      throw new Error('Could not load the PDF reader. Check your internet connection.', { cause: err });
    });
  }
  return pdfjsPromise;
}

/**
 * Extracts plain text from a PDF, keeping line breaks.
 * @param {File} file
 * @returns {Promise<string>}
 * @throws {Error} for non-PDF files, files over 10 MB, or PDFs without a text layer.
 */
export async function extractPdfText(file) {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    throw new Error('Please choose a PDF file.');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('That PDF is larger than 10 MB.');
  }

  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const { items } = await page.getTextContent();
    pages.push(items.map(item => item.str + (item.hasEOL ? '\n' : '')).join(''));
  }
  await doc.destroy();

  const text = pages.join('\n\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 30) {
    throw new Error('No text found in this PDF. It is probably a scanned image; paste the text instead.');
  }
  return text;
}
