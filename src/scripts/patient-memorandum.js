(function () {
  "use strict";

  const scriptUrl = document.currentScript.src;
  const libraryUrl = new URL("vendor/docx-9.10.0.js", scriptUrl).href;
  const assetsUrl = new URL("../assets/memorandum/", scriptUrl);
  let libraryPromise;
  let artworkPromise;

  function loadLibrary() {
    if (!libraryPromise) {
      libraryPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = libraryUrl;
        script.onload = () => window.docx ? resolve(window.docx) : reject(new Error("Word biblioteka nije dostupna."));
        script.onerror = () => {
          script.remove();
          reject(new Error("Word biblioteka nije učitana. Pokušajte ponovo."));
        };
        document.head.appendChild(script);
      }).catch(error => {
        libraryPromise = null;
        throw error;
      });
    }
    return libraryPromise;
  }

  function loadArtwork() {
    if (!artworkPromise) {
      artworkPromise = Promise.all(["header.png", "footer.png"].map(async name => {
        const response = await fetch(new URL(name, assetsUrl));
        if (!response.ok) throw new Error("Izgled memoranduma nije učitan. Pokušajte ponovo.");
        return new Uint8Array(await response.arrayBuffer());
      })).catch(error => {
        artworkPromise = null;
        throw error;
      });
    }
    return artworkPromise;
  }

  async function createBlob(patientName, createdAt) {
    const name = String(patientName || "").trim();
    if (!name) throw new Error("Pacijent nije učitan.");
    const date = window.DrRosaDateUtils.formatDate(createdAt);
    if (date === "-") throw new Error("Datum računara nije ispravan.");
    const [d, [header, footer]] = await Promise.all([loadLibrary(), loadArtwork()]);
    const noBorder = { style: d.BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const line = { style: d.BorderStyle.SINGLE, size: 4, color: "B8C2CC" };
    const borders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
    const paragraph = (text, options = {}) => new d.Paragraph({
      spacing: { after: 160 },
      children: [new d.TextRun(text)],
      ...options
    });
    const fieldRow = label => new d.TableRow({
      height: { value: 560, rule: d.HeightRule.ATLEAST },
      children: [
        new d.TableCell({
          width: { size: 1800, type: d.WidthType.DXA }, borders,
          children: [paragraph("", { children: [new d.TextRun({ text: label, bold: true })] })]
        }),
        new d.TableCell({
          width: { size: 8667, type: d.WidthType.DXA }, borders: { ...borders, bottom: line },
          children: [paragraph("")]
        })
      ]
    });
    const artwork = (data, height) => new d.Paragraph({
      spacing: { before: 0, after: 0 },
      children: [new d.ImageRun({
        type: "png", data,
        transformation: { width: 697.8, height },
        altText: { name: height > 100 ? "Zaglavlje memoranduma" : "Podnožje memoranduma", title: "Memorandum ordinacije dr Rosa Bašić", description: "" }
      })]
    });
    const document = new d.Document({
      creator: "Dr Rosa Dental",
      title: "Memorandum",
      styles: {
        default: { document: { run: { font: "Arial", size: 24, color: "000000" } } }
      },
      sections: [{
        properties: {
          page: {
            size: { width: 11907, height: 16839 },
            margin: { top: 2450, bottom: 1420, left: 720, right: 720, header: 283, footer: 283 }
          }
        },
        headers: { default: new d.Header({ children: [artwork(header, 120.1)] }) },
        footers: { default: new d.Footer({ children: [artwork(footer, 43)] }) },
        children: [
          paragraph("", { children: [new d.TextRun({ text: "Pacijent: ", bold: true }), new d.TextRun(name)] }),
          paragraph("", {
            spacing: { after: 400 },
            children: [new d.TextRun({ text: "Datum: ", bold: true }), new d.TextRun(date)]
          }),
          new d.Table({
            width: { size: 10467, type: d.WidthType.DXA },
            columnWidths: [1800, 8667],
            borders: { ...borders, insideHorizontal: noBorder, insideVertical: noBorder },
            rows: [fieldRow("Doktor:"), fieldRow("Delatnost:"), fieldRow("Postupak:")]
          }),
          paragraph("", { spacing: { before: 300, after: 180 }, children: [new d.TextRun({ text: "Detalji rada:", bold: true })] }),
          new d.Table({
            width: { size: 10467, type: d.WidthType.DXA }, columnWidths: [10467],
            borders: { top: line, bottom: line, left: line, right: line, insideHorizontal: noBorder, insideVertical: noBorder },
            rows: [new d.TableRow({
              height: { value: 3200, rule: d.HeightRule.ATLEAST },
              children: [new d.TableCell({
                margins: { top: 120, bottom: 120, left: 120, right: 120 },
                children: [paragraph("")]
              })]
            })]
          }),
          paragraph("")
        ]
      }]
    });
    return d.Packer.toBlob(document);
  }

  function fileName(patientName, createdAt) {
    const name = String(patientName).normalize("NFC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
      .trim().replace(/\s+/g, "_").slice(0, 100) || "Pacijent";
    return `Memorandum_${name}_${window.DrRosaDateUtils.isoDateKey(createdAt)}.docx`;
  }

  function bind(button, patientName, message) {
    if (!button || !String(patientName || "").trim()) return;
    button.disabled = false;
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      // Capture the local computer's date at the click, before loading dependencies.
      const createdAt = new Date();
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.textContent = "Priprema dokumenta…";
      message.textContent = "";
      try {
        const blob = await createBlob(patientName, createdAt);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName(patientName, createdAt);
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        message.textContent = "Memorandum je spreman za preuzimanje.";
      } catch (error) {
        message.textContent = error.message || "Memorandum nije napravljen. Pokušajte ponovo.";
      } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.textContent = "Memorandum";
      }
    });
  }

  window.DrRosaMemorandum = { bind, createBlob };
})();
