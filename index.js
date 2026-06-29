const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { OpenAI } = require('openai');
const multer = require('multer');
const pdfParse = require('pdf-parse');

const app = express();
const port = 8501;

// Setup multer untuk handle file upload memory (tanpa simpan disk)
const upload = multer({ storage: multer.memoryStorage() });

// Setup client pointing to local 9Router API gateway
const openai = new OpenAI({
    apiKey: 'sk-e085ba40f2c63bcd-ujrg8r-ce531b89',
    baseURL: 'http://localhost:20128/v1'
});

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initial blank data state
let rppState = {
    spesifikasi: {
        satuan_pendidikan: "SMK Kartika X-1",
        mata_pelajaran: "Mapel Pilihan (Data Science)",
        kelas_semester: "XI TKJ / Ganjil (Fase F - 1 Semester)",
        topik: "",
        alokasi_waktu: "72 JP (Pertemuan 1 s.d. 18 @ 4 JP)"
    },
    identifikasi: {
        asesmen_awal: "",
        dpl: { dpl1: false, dpl2: false, dpl3: true, dpl4: true, dpl5: true, dpl6: true, dpl7: false, dpl8: true },
        nilai_5nk: { budi_luhur: true, disiplin: true, cinta_tanah_air: true, cerdas: true, terampil: true },
        indikator_5nk: "",
        materi_integrasi: ""
    },
    desain: {
        tujuan_pembelajaran: [],
        metode: "Project Based Learning (PjBL)",
        kemitraan: "",
        lingkungan: "",
        digital: ""
    },
    pengalaman: {
        awal: [],
        inti_memahami: [],
        inti_mengaplikasi: [],
        inti_merefleksi: [],
        penutup: []
    },
    asesmen: {
        proses: "",
        akhir: ""
    },
    signatures: {
        kepala_sekolah: "M. Hidayatullah, S.Kom",
        guru: "Allan Parindera, S.Kom",
        tanggal: "Jakarta, 6 Juli 2026"
    },
    lampiran: {
        pertemuan: [],
        l1_diagnostik: "",
        l2_lkpd: "",
        l3_rubrik: "",
        l4_materi: "",
        l5_soal: ""
    }
};

app.get('/api/state', (req, res) => {
    res.json(rppState);
});

app.post('/api/state', (req, res) => {
    rppState = req.body;
    res.json({ success: true });
});

app.post('/api/parse', async (req, res) => {
    const { text } = req.body;
    try {
        // Ambil 10000 karakter pertama agar akurat
        const trimmed = text.substring(0, 10000);
        const prompt = `Uraikan RPP lama berikut ke dalam JSON terstandarisasi untuk RPP 5NK. Kembalikan HANYA JSON valid tanpa teks lain.

Kunci JSON wajib dan strukturnya:
{
  "spesifikasi": {
    "satuan_pendidikan": "string",
    "mata_pelajaran": "string",
    "kelas_semester": "string",
    "topik": "string",
    "alokasi_waktu": "string"
  },
  "identifikasi": {
    "asesmen_awal": "string",
    "dpl": {"dpl1":true,"dpl2":false,"dpl3":true,"dpl4":true,"dpl5":true,"dpl6":true,"dpl7":false,"dpl8":true},
    "nilai_5nk": {"budi_luhur":true,"disiplin":true,"cinta_tanah_air":true,"cerdas":true,"terampil":true},
    "indikator_5nk": "string",
    "materi_integrasi": "string"
  },
  "desain": {
    "tujuan_pembelajaran": ["string"],
    "metode": "string",
    "kemitraan": "string",
    "lingkungan": "string",
    "digital": "string"
  },
  "pengalaman": {
    "awal": ["string"],
    "inti_memahami": ["string"],
    "inti_mengaplikasi": ["string"],
    "inti_merefleksi": ["string"],
    "penutup": ["string"]
  },
  "asesmen": {
    "proses": "string",
    "akhir": "string"
  },
  "lampiran": {
    "pertemuan": [{"no":"1","jp":"4","materi":"string","integrasi":"string","aktivitas":"string"}],
    "l1_diagnostik": "string",
    "l2_lkpd": "string",
    "l3_rubrik": "string",
    "l4_materi": "string",
    "l5_soal": "string"
  }
}

Isi nilai-nilai string berdasarkan ekstraksi cerdas dari teks RPP Lama berikut:
${trimmed}`;
        const response = await openai.chat.completions.create({
            model: "ag/gemini-3-flash",
            messages: [{ role: "user", content: prompt }]
        });
        const respText = response.choices[0].message.content;
        const jsonMatch = respText.match(/\{[\s\S]*\}/);
        const result = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(respText);
        rppState = { ...rppState, ...result };
        res.json({ success: true, data: rppState });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Endpoint untuk upload PDF dan parse isinya
app.post('/api/upload-pdf', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "File tidak terupload." });
        }
        const data = await pdfParse(req.file.buffer);
        res.json({ text: data.text });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/generate', async (req, res) => {
    const { topic, classLevel, totalJp } = req.body;
    try {
        const prompt = `Buat RPP 5NK baru untuk topik ${topic}, kelas ${classLevel}, alokasi ${totalJp}. Kembalikan HANYA JSON valid tanpa teks lain, dengan kunci: spesifikasi, identifikasi, desain, pengalaman, asesmen, lampiran.`;
        const response = await openai.chat.completions.create({
            model: "ag/gemini-3.5-flash-low",
            messages: [{ role: "user", content: prompt }]
        });
        const respText = response.choices[0].message.content;
        const jsonMatch = respText.match(/\{[\s\S]*\}/);
        const result = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(respText);
        rppState = { ...rppState, ...result };
        res.json({ success: true, data: rppState });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

function buildHtml(data) {
    const spec = data.spesifikasi || {};
    const ident = data.identifikasi || {};
    const desain = data.desain || {};
    const peng = data.pengalaman || {};
    const asm = data.asesmen || {};
    const sigs = data.signatures || {};
    const lamp = data.lampiran || {};

    const _renderCheckbox = (c) => c ? "[&radic;]" : "[ ]";
    
    // Simple HTML assembler matching 5NK Times New Roman specs
    let html = `
    <html>
    <head>
        <style>
            body { font-family: "Times New Roman", Times, serif; font-size: 12px; line-height: 1.25; color: #000; margin: 40px; }
            h1, h2, h3, h4 { text-align: center; color: #000; font-weight: bold; margin: 10px 0; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 12px; }
            tr { page-break-inside: avoid; }
            th, td { border: 1px solid #000; padding: 12px 14px; vertical-align: top; }
            .bg-gray { background-color: #f2f2f2; font-weight: bold; }
            .page-break { page-break-before: always; }
            .signature-table { width: 100%; border: none; margin-top: 50px; }
            .signature-table td { border: none; padding: 0; width: 50%; }
            .pre-text { white-space: pre-wrap; font-family: "Times New Roman", Times, serif; font-size: 12px; line-height: 1.3; }
        </style>
    </head>
    <body>
        <h2>RENCANA PELAKSANAAN PEMBELAJARAN (RPP)<br>TERINTEGRASI 5 NILAI KARTIKA (5NK)</h2>
        <table>
            <tr class="bg-gray"><td width="5%"><b>A</b></td><td width="30%"><b>Spesifikasi</b></td><td></td></tr>
            <tr><td>1</td><td>Satuan Pendidikan</td><td>${spec.satuan_pendidikan || ''}</td></tr>
            <tr><td>2</td><td>Mata Pelajaran</td><td>${spec.mata_pelajaran || ''}</td></tr>
            <tr><td>3</td><td>Kelas / Semester</td><td>${spec.kelas_semester || ''}</td></tr>
            <tr><td>4</td><td>Topik Pembelajaran</td><td>${spec.topik || ''}</td></tr>
            <tr><td>5</td><td>Alokasi Waktu</td><td>${spec.alokasi_waktu || ''}</td></tr>
        </table>
        
        <table>
            <tr class="bg-gray"><td width="5%"><b>B</b></td><td width="30%"><b>Identifikasi</b></td><td></td></tr>
            <tr><td>1</td><td>Asesmen Diagnostik / Awal</td><td>${ident.asesmen_awal || ''}</td></tr>
            <tr><td>2</td><td>Dimensi Profil Lulusan</td><td>
                ${_renderCheckbox(ident.dpl?.dpl1)} DPL 1 Keimanan<br>
                ${_renderCheckbox(ident.dpl?.dpl2)} DPL 2 Kewargaan<br>
                ${_renderCheckbox(ident.dpl?.dpl3)} DPL 3 Penalaran Critis<br>
                ${_renderCheckbox(ident.dpl?.dpl4)} DPL 4 Kreativitas<br>
                ${_renderCheckbox(ident.dpl?.dpl5)} DPL 5 Kolaborasi<br>
                ${_renderCheckbox(ident.dpl?.dpl6)} DPL 6 Kemandirian<br>
                ${_renderCheckbox(ident.dpl?.dpl7)} DPL 7 Kesehatan<br>
                ${_renderCheckbox(ident.dpl?.dpl8)} DPL 8 Komunikasi
            </td></tr>
            <tr><td>3</td><td>Penguatan Karakter 5NK</td><td>
                ${_renderCheckbox(ident.nilai_5nk?.budi_luhur)} Berbudi Luhur<br>
                ${_renderCheckbox(ident.nilai_5nk?.disiplin)} Disiplin<br>
                ${_renderCheckbox(ident.nilai_5nk?.cinta_tanah_air)} Cinta Tanah Air<br>
                ${_renderCheckbox(ident.nilai_5nk?.cerdas)} Cerdas<br>
                ${_renderCheckbox(ident.nilai_5nk?.terampil)} Terampil
            </td></tr>
            <tr><td>4</td><td>Indikator 5NK</td><td>${ident.indikator_5nk || ''}</td></tr>
            <tr><td>5</td><td>Materi Integrasi 5NK</td><td>${ident.materi_integrasi || ''}</td></tr>
        </table>

        <div class="page-break"></div>
        <table>
            <tr class="bg-gray"><td width="5%"><b>C</b></td><td colspan="2"><b>Desain Pembelajaran</b></td></tr>
            <tr><td>1</td><td width="25%">Tujuan Pembelajaran</td><td>${(desain.tujuan_pembelajaran || []).map(t => `- ${t}`).join('<br>')}</td></tr>
            <tr><td>2</td><td>Kerangka Pembelajaran</td><td>
                <b>a. Model:</b> ${desain.metode || 'PjBL'}<br>
                <b>b. Kemitraan:</b> ${desain.kemitraan || ''}<br>
                <b>c. Lingkungan:</b> ${desain.lingkungan || ''}<br>
                <b>d. Digital:</b> ${desain.digital || ''}
            </td></tr>
        </table>

        <table>
            <tr class="bg-gray"><td width="5%"><b>D</b></td><td colspan="2"><b>Pengalaman Belajar</b></td></tr>
            <tr><td>1</td><td colspan="2"><b>Kegiatan Awal:</b><br>${(peng.awal || []).map(t => `- ${t}`).join('<br>')}</td></tr>
            <tr><td rowspan="3">2</td><td width="15%" class="bg-gray">Memahami</td><td>${(peng.inti_memahami || []).join('<br>')}</td></tr>
            <tr><td class="bg-gray">Mengaplikasi</td><td>${(peng.inti_mengaplikasi || []).join('<br>')}</td></tr>
            <tr><td class="bg-gray">Merefleksi</td><td>${(peng.inti_merefleksi || []).join('<br>')}</td></tr>
            <tr><td>3</td><td colspan="2"><b>Kegiatan Penutup:</b><br>${(peng.penutup || []).map(t => `- ${t}`).join('<br>')}</td></tr>
        </table>

        <table>
            <tr class="bg-gray"><td width="5%"><b>E</b></td><td width="30%"><b>Asesmen</b></td><td></td></tr>
            <tr><td>1</td><td>Proses</td><td>${asm.proses || ''}</td></tr>
            <tr><td>2</td><td>Akhir</td><td>${asm.akhir || ''}</td></tr>
        </table>

        <table class="signature-table">
            <tr>
                <td>Mengetahui,<br>Kepala Sekolah SMK Kartika X-1<br><br><br><br><b>${sigs.kepala_sekolah || ''}</b></td>
                <td>Guru Mata Pelajaran<br><br><br><br><b>${sigs.guru || ''}</b></td>
            </tr>
        </table>

        <div class="page-break"></div>
        <h2>LAMPIRAN RPP 5NK</h2>
        
        <div class="page-break"></div>
        <h3>LAMPIRAN 1: INSTRUMEN ASESMEN AWAL (DIAGNOSTIK)</h3>
        <div class="pre-text">${lamp.l1_diagnostik || ''}</div>
        
        <div class="page-break"></div>
        <h3>LAMPIRAN 2: LEMBAR KERJA PESERTA DIDIK (LKPD)</h3>
        <div class="pre-text">${lamp.l2_lkpd || ''}</div>

        <div class="page-break"></div>
        <h3>LAMPIRAN 3: RUBRIK ASESMEN</h3>
        <div class="pre-text">${lamp.l3_rubrik || ''}</div>

        <div class="page-break"></div>
        <h3>LAMPIRAN 4: RINGKASAN MATERI PEMBELAJARAN</h3>
        <div class="pre-text">${lamp.l4_materi || ''}</div>

        <div class="page-break"></div>
        <h3>LAMPIRAN 5: SOAL EVALUASI & KUNCI JAWABAN</h3>
        <div class="pre-text">${lamp.l5_soal || ''}</div>
    </body>
    </html>`;
    return html;
}

// Endpoint untuk evaluasi, review, dan koreksi RPP otomatis
app.post('/api/improve', async (req, res) => {
    const { actionType } = req.body;
    try {
        let prompt = "";
        if (actionType === 'review') {
            prompt = `Analisis data RPP saat ini: ${JSON.stringify(rppState)}.
Tinjau kesesuaian target kurikulum, integrasi nilai 5NK (Budi Luhur, Disiplin, Cinta Tanah Air, Cerdas, Terampil), serta konsistensi sintaks Kegiatan Inti (Memahami, Mengaplikasi, Merefleksi).
Berikan laporan analisis singkat, kritis, dan saran perbaikan dalam format bahasa Indonesia yang mudah dipahami.`;
            const response = await openai.chat.completions.create({
                model: "ag/gemini-3-flash",
                messages: [{ role: "user", content: prompt }]
            });
            return res.json({ success: true, feedback: response.choices[0].message.content });
        } else if (actionType === 'auto_fix') {
            prompt = `Koreksi dan perbaiki seluruh data RPP ini agar sesuai standar RPP 5NK SMK Kartika X-1: ${JSON.stringify(rppState)}.
Tugas Utama Anda:
1. Suntikkan nilai-nilai 5NK yang kurang.
2. Buat kegiatan belajar menjadi runut (Memahami, Mengaplikasi, Merefleksi).
3. Lengkapi bagian lampiran (l1 sampai l5) secara otomatis dengan konten detail yang relevan dengan topik pembelajaran (Jangan gunakan string kosong atau placeholder singkat). Gunakan template resmi SMK Kartika X-1:
   - l1_diagnostik: Isi dengan Instrumen Asesmen Awal (Kognitif berupa soal pilihan ganda/esai logika & Non-Kognitif tentang kesiapan laptop/minat).
   - l2_lkpd: Langkah kerja berkelompok (Integrasi 5NK - Cerdas, Terampil, Cinta Tanah Air) dengan tabel tugas eksplorasi.
   - l3_rubrik: Rubrik asesmen sumatif proyek (skala nilai 90-100, 80-89, 70-79, <70) mencakup aspek kode, analisis, presentasi, kolaborasi, dan rumus nilai akhir.
   - l4_materi: Ringkasan materi pembelajaran teoritis lengkap dari pertemuan awal hingga akhir.
   - l5_soal: Bank Soal evaluasi tertulis pilihan ganda minimal 5-10 nomor lengkap dengan kunci jawabannya.
Kembalikan HANYA JSON hasil perbaikan tanpa teks tambahan apapun, dengan struktur kunci persis seperti input.`;
            const response = await openai.chat.completions.create({
                model: "ag/gemini-3-flash",
                messages: [{ role: "user", content: prompt }]
            });
            const respText = response.choices[0].message.content;
            const jsonMatch = respText.match(/\{[\s\S]*\}/);
            const result = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(respText);
            rppState = { ...rppState, ...result };
            return res.json({ success: true, data: rppState });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/export', (req, res) => {
    // Pakai state terbaru dari body request (simpan dari frontend)
    const state = req.body || rppState;
    const htmlContent = buildHtml(state);
    const htmlPath = path.join(__dirname, 'rpp.html');
    const pdfPath = path.join(__dirname, 'rpp.pdf');
    
    fs.writeFileSync(htmlPath, htmlContent);
    
    // Matikan warning X11 untuk headless wkhtmltopdf
    const cmd = `wkhtmltopdf --quiet --page-size A4 --margin-top 15mm --margin-bottom 15mm --margin-left 25mm --margin-right 25mm ${htmlPath} ${pdfPath}`;
    
    exec(cmd, (err) => {
        if (err) {
            console.error("PDF generation error:", err);
            return res.status(500).json({ error: err.message });
        }
        res.sendFile(pdfPath);
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
