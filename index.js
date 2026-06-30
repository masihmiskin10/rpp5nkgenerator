const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { OpenAI } = require('openai');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 8501;

const upload = multer({ storage: multer.memoryStorage() });

// Setup client pointing to local 9Router API gateway or dynamic environment URL
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'sk-e085ba40f2c63bcd-iaxa6d-ff2194e5',
    baseURL: process.env.OPENAI_BASE_URL || 'http://localhost:20128/v1',
    timeout: 30000 // 30s timeout to prevent hanging requests
});

// Fix 11: limit upload size
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory sessions to replace global mutable state (Fix 1)
const sessions = new Map();

function getSessionState(req) {
    const sessionId = req.headers['x-session-id'] || 'default';
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
            spesifikasi: {
                satuan_pendidikan: "SMK Kartika X-1",
                mata_pelajaran: "Data Science (Konsentrasi Keahlian TKJ - Mapel Pilihan)",
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
        });
    }
    return sessions.get(sessionId);
}

function setSessionState(req, state) {
    const sessionId = req.headers['x-session-id'] || 'default';
    sessions.set(sessionId, state);
}

// Fix 5: RPP schema definition
const RPP_JSON_SCHEMA = JSON.stringify({
  spesifikasi: {
    satuan_pendidikan: "SMK Kartika X-1",
    mata_pelajaran: "Data Science (Konsentrasi Keahlian TKJ - Mapel Pilihan)",
    kelas_semester: "string (misal: XI TKJ / Ganjil (Fase F - 1 Semester))",
    topik: "string",
    alokasi_waktu: "string"
  },
  identifikasi: {
    asesmen_awal: "string",
    dpl: {dpl1:true,dpl2:false,dpl3:true,dpl4:true,dpl5:true,dpl6:true,dpl7:false,dpl8:true},
    nilai_5nk: {budi_luhur:true,disiplin:true,cinta_tanah_air:true,cerdas:true,terampil:true},
    indikator_5nk: "string",
    materi_integrasi: "string"
  },
  desain: {
    tujuan_pembelajaran: ["string"],
    metode: "string",
    kemitraan: "string",
    lingkungan: "string",
    digital: "string"
  },
  pengalaman: {
    awal: ["string"],
    inti_memahami: ["string"],
    inti_mengaplikasi: ["string"],
    inti_merefleksi: ["string"],
    penutup: ["string"]
  },
  asesmen: { proses: "string", akhir: "string" },
  lampiran: {
    pertemuan: [{no:"1",jp:"4",materi:"string",integrasi:"string",aktivitas:"string"}],
    l1_diagnostik: "string",
    l2_lkpd: "string",
    l3_rubrik: "string",
    l4_materi: "string",
    l5_soal: "string"
  }
});

// Fix 4: Regex Parsing Robustness
function parseLLMJson(respText) {
    // Cari markdown json block first
    const codeBlockMatch = respText.match(/```json\s*([\s\S]*?)\s*```/);
    const raw = codeBlockMatch ? codeBlockMatch[1] : respText;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
}

app.get('/api/state', (req, res) => {
    res.json(getSessionState(req));
});

app.post('/api/state', (req, res) => {
    setSessionState(req, req.body);
    res.json({ success: true });
});

app.post('/api/parse', async (req, res) => {
    const { text, model } = req.body;
    const selectedModel = model || "ag/gemini-3.1-pro-low";
    const currentState = getSessionState(req);
    try {
        const trimmed = text.substring(0, 100000); // Increased from 10k to 100k characters
        const prompt = `Uraikan RPP lama berikut ke dalam JSON terstandarisasi untuk RPP 5NK. Kembalikan HANYA JSON valid tanpa teks lain.\n\nKunci JSON wajib dan strukturnya:\n${RPP_JSON_SCHEMA}\n\nIsi nilai-nilai string berdasarkan ekstraksi cerdas dari teks RPP Lama berikut:\n${trimmed}`;
        const response = await openai.chat.completions.create({
            model: selectedModel,
            messages: [{ role: "user", content: prompt }]
        });
        const respText = response.choices[0].message.content;
        const result = parseLLMJson(respText);
        const updated = { ...currentState, ...result };
        setSessionState(req, updated);
        res.json({ success: true, data: updated });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

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
    const { topic, classLevel, totalJp, guideline, model } = req.body;
    const selectedModel = model || "ag/gemini-3.1-pro-low";
    const currentState = getSessionState(req);
    try {
        const prompt = `Anda adalah AI Asisten Kurikulum Merdeka 5NK di SMK Kartika X-1.
Buat RPP 5NK baru untuk topik ${topic}, kelas ${classLevel}, alokasi ${totalJp}.
Instruksi tambahan yang wajib dipatuhi: ${guideline || 'None'}.

Kunci JSON wajib dan strukturnya:
${RPP_JSON_SCHEMA}

Kembalikan HANYA JSON valid tanpa teks lain.`;
        const response = await openai.chat.completions.create({
            model: selectedModel,
            messages: [{ role: "user", content: prompt }]
        });
        const respText = response.choices[0].message.content;
        const result = parseLLMJson(respText);
        const updated = { ...currentState, ...result };
        setSessionState(req, updated);
        res.json({ success: true, data: updated });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

function buildHtml(data, config = {}) {
    const spec = data.spesifikasi || {};
    const ident = data.identifikasi || {};
    const desain = data.desain || {};
    const peng = data.pengalaman || {};
    const asm = data.asesmen || {};
    const sigs = data.signatures || {};
    const lamp = data.lampiran || {};

    const _renderCheckbox = (c) => c ? "[&radic;]" : "[ ]";
    const _arr = (val) => Array.isArray(val) ? val : [];
    
    let pertemuanRows = '';
    if (lamp.pertemuan && lamp.pertemuan.length > 0) {
        pertemuanRows = lamp.pertemuan.map(p => `
        <tr>
            <td align="center" style="padding: 6px 4px;"><b>${p.no || ''}</b></td>
            <td align="center" style="padding: 6px 4px;">${p.jp || ''}</td>
            <td style="padding: 6px 8px; font-size: 10.5px;">${p.materi || ''}</td>
            <td style="padding: 6px 8px; font-size: 10.5px;">${p.integrasi || ''}</td>
            <td style="padding: 6px 8px; font-size: 10.5px;">${p.aktivitas || ''}</td>
        </tr>`).join('\n');
    }

    const safeNL = (txt) => {
        if (!txt) return '';
        return String(txt).replace(/\n/g, '<br>');
    };

    return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: "Times New Roman", Times, serif; font-size: 12px; line-height: 1.35; color: #000; }
        h1, h2, h3 { text-align: center; color: #000; margin-top: 18px; margin-bottom: 12px; font-weight: bold; }
        h4 { color: #000; margin-top: 15px; margin-bottom: 6px; font-weight: bold; }
        
        table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 12px; } tr { page-break-inside: avoid; }
        th, td { border: 1px solid #000; padding: ${config.padding || '14px 18px'}; vertical-align: top; }
        
        .bg-gray { background-color: #e0e0e0; font-weight: bold; }
        .text-blue { color: #0000ff; }
        .text-italic { font-style: italic; }
        .page-break { page-break-before: always; }
        
        .signature-container { width: 100%; margin-top: 40px; }
        .signature-table { width: 100%; border: none; }
        .signature-table td { border: none; padding: 0; width: 50%; vertical-align: top; }
        .tight-table td { padding: 6px 10px; }
        
        ul, ol { margin-top: 2px; padding-left: 20px; margin-bottom: 2px; }
        p { margin-top: 2px; margin-bottom: 2px; }
        .box { border: 1px solid #000; padding: 10px; margin-bottom: 15px; background-color: #f9f9f9; }
        .code-block { font-family: monospace; background-color: #f1f1f1; padding: 6px; border: 1px solid #ccc; display: block; white-space: pre-wrap; font-size: 11px; margin-top: 4px; }
        
        /* CSS paged media untuk memecah preview jadi layout kertas A4 fisik */
        @media screen {
            html { background-color: #f0f0f0; }
            body { 
                background-color: white; 
                width: 210mm; /* Lebar A4 */
                min-height: 297mm; /* Tinggi A4 */
                margin: 0 auto; 
                padding: ${config.padding || '20mm'} !important; 
                box-shadow: 0 4px 10px rgba(0,0,0,0.1); 
                box-sizing: border-box; 
                position: relative;
            }
            .page-break { 
                display: block;
                height: 0;
                border-bottom: 2px dashed #ff0000;
                margin-top: 40px;
                margin-bottom: 40px;
                position: relative;
                page-break-before: always;
            }
            .page-break::after {
                content: "Batas Kertas / Potong Halaman (Page Break)";
                position: absolute;
                top: -10px;
                left: 50%;
                transform: translateX(-50%);
                background: white;
                padding: 0 10px;
                color: #ff0000;
                font-weight: bold;
                font-size: 10px;
                font-family: sans-serif;
            }
        }
        @media print {
            body { padding: 0; margin: 0; box-shadow: none; width: auto; height: auto; }
            .page-break::after { display: none; }
            .page-break { border: none; margin: 0; }
        }
    </style>
</head>
<body>

    <h2 style="font-size: 14px; text-transform: uppercase;">RENCANA PELAKSANAAN PEMBELAJARAN (RPP) MENDALAM TERINTEGRASI 5NK<br>UNTUK TINGKAT SMK</h2>

    <!-- SECTION A -->
    <table class="tight-table">
        <tr class="bg-gray">
            <td width="5%"><b>A</b></td>
            <td width="30%"><b>Spesifikasi</b></td>
            <td></td>
        </tr>
        <tr><td>1</td><td>Satuan Pendidikan</td><td>${spec.satuan_pendidikan || ''}</td></tr>
        <tr><td>2</td><td>Mata Pelajaran</td><td>${spec.mata_pelajaran || ''}</td></tr>
        <tr><td>3</td><td>Kelas / Semester</td><td>${spec.kelas_semester || ''}</td></tr>
        <tr><td>4</td><td>Topik Pembelajaran</td><td>${spec.topik || ''}</td></tr>
        <tr><td>5</td><td>Alokasi Waktu</td><td>${spec.alokasi_waktu || ''}</td></tr>
    </table>

    <!-- SECTION B -->
    <table>
        <tr class="bg-gray">
            <td width="5%"><b>B</b></td>
            <td width="30%"><b>Identifikasi</b></td>
            <td></td>
        </tr>
        <tr>
            <td>1</td>
            <td>Asesmen Diagnostik/ Awal Pembelajaran</td>
            <td>${safeNL(ident.asesmen_awal)}</td>
        </tr>
        <tr>
            <td>2</td>
            <td>Dimensi Profil Lulusan</td>
            <td>
                ${_renderCheckbox(ident.dpl?.dpl1)} DPL 1 Keimanan dan Ketakwaan kepada Tuhan YME<br>
                ${_renderCheckbox(ident.dpl?.dpl2)} DPL 2 Kewargaan<br>
                ${_renderCheckbox(ident.dpl?.dpl3)} DPL 3 Penalaran Kritis<br>
                ${_renderCheckbox(ident.dpl?.dpl4)} DPL 4 Kreativitas<br>
                ${_renderCheckbox(ident.dpl?.dpl5)} DPL 5 Kolaborasi<br>
                ${_renderCheckbox(ident.dpl?.dpl6)} DPL 6 Kemandirian<br>
                ${_renderCheckbox(ident.dpl?.dpl7)} DPL 7 Kesehatan<br>
                ${_renderCheckbox(ident.dpl?.dpl8)} DPL 8 Komunikasi
            </td>
        </tr>
        <tr>
            <td>3</td>
            <td>Penguatan Karakter 5NK</td>
            <td>
                ${_renderCheckbox(ident.nilai_5nk?.budi_luhur)} Berbudi Luhur<br>
                ${_renderCheckbox(ident.nilai_5nk?.disiplin)} Disiplin<br>
                ${_renderCheckbox(ident.nilai_5nk?.cinta_tanah_air)} Cinta Tanah Air<br>
                ${_renderCheckbox(ident.nilai_5nk?.cerdas)} Cerdas<br>
                ${_renderCheckbox(ident.nilai_5nk?.terampil)} Terampil
            </td>
        </tr>
        <tr>
            <td>4</td>
            <td>Indikator 5NK</td>
            <td>${safeNL(ident.indikator_5nk)}</td>
        </tr>
        <tr>
            <td>5</td>
            <td>Materi Integrasi 5NK</td>
            <td>${safeNL(ident.materi_integrasi)}</td>
        </tr>
    </table>

    <div class="page-break"></div>

    <!-- SECTION C -->
    <table>
        <tr class="bg-gray">
            <td width="5%"><b>C</b></td>
            <td colspan="2"><b>Desain Pembelajaran</b></td>
        </tr>
        <tr>
            <td>1</td>
            <td width="25%">Tujuan Pembelajaran</td>
            <td>
                <ol>
                    ${_arr(desain.tujuan_pembelajaran).map(t => `<li>${t}</li>`).join('')}
                </ol>
            </td>
        </tr>
        <tr>
            <td>2</td>
            <td>Kerangka Pembelajaran</td>
            <td>
                <b>a. Praktik Pedagogis</b><br>
                1) Model Pembelajaran: <span class="text-blue">${desain.metode || ''}</span><br><br>
                
                <b>b. Kemitraan pembelajaran:</b><br>
                <span class="text-blue">${desain.kemitraan || ''}</span><br><br>
                
                <b>c. Lingkungan Pembelajaran</b><br>
                <span class="text-blue">${desain.lingkungan || ''}</span><br><br>
                
                <b>d. Pemanfaatan Digital:</b><br>
                <span class="text-blue">${desain.digital || ''}</span>
            </td>
        </tr>
    </table>
    
    <!-- SECTION D -->
    <table style="margin-bottom: 0px;">
        <tr class="bg-gray">
            <td width="5%"><b>D</b></td>
            <td colspan="2"><b>Pengalaman Belajar</b></td>
        </tr>
        <tr>
            <td>1</td>
            <td colspan="2">
                <b>Kegiatan Awal</b><br>
                <ul>${_arr(peng.awal).map(t => `<li>${t}</li>`).join('')}</ul>
            </td>
        </tr>
        <tr>
            <td rowspan="3">2</td>
            <td width="15%" class="bg-gray" style="text-align: center; vertical-align: middle;"><b>Memahami</b></td>
            <td><ul>${_arr(peng.inti_memahami).map(t => `<li>${t}</li>`).join('')}</ul></td>
        </tr>
        <tr>
            <td class="bg-gray" style="text-align: center; vertical-align: middle;"><b>Mengaplikasi</b></td>
            <td><ul>${_arr(peng.inti_mengaplikasi).map(t => `<li>${t}</li>`).join('')}</ul></td>
        </tr>
        <tr>
            <td class="bg-gray" style="text-align: center; vertical-align: middle;"><b>Merefleksi</b></td>
            <td><ul>${_arr(peng.inti_merefleksi).map(t => `<li>${t}</li>`).join('')}</ul></td>
        </tr>
        <tr>
            <td>3</td>
            <td colspan="2">
                <b>Kegiatan Penutup</b><br>
                <ul>${_arr(peng.penutup).map(t => `<li>${t}</li>`).join('')}</ul>
            </td>
        </tr>
    </table>

    <!-- SECTION E & SIGNATURES -->
    <table style="margin-top: 15px; margin-bottom: 15px;">
        <tr class="bg-gray">
            <td width="5%"><b>E</b></td>
            <td width="30%"><b>Assesmen Pembelajaran</b></td>
            <td></td>
        </tr>
        <tr>
            <td>1</td>
            <td>Assesmen Proses</td>
            <td>${asm.proses || ''}</td>
        </tr>
        <tr>
            <td>2</td>
            <td>Assesmen Akhir</td>
            <td>${asm.akhir || ''}</td>
        </tr>
    </table>

    <!-- SIGNATURE BLOCK -->
    <div class="signature-container" style="margin-top: 30px;">
        <table style="width: 100%; border: none; margin-top: 10px;">
            <tr>
                <td style="border: none; width: 50%; padding: 0;"></td>
                <td style="border: none; width: 50%; padding: 0; text-align: center;">
                    ${sigs.tanggal || 'Jakarta, ..........................'}<br><br>
                </td>
            </tr>
            <tr>
                <td style="border: none; width: 50%; padding: 0; text-align: center; vertical-align: top;">
                    Mengetahui,<br>
                    Kepala Sekolah SMK Kartika X-1<br>
                    <br><br><br><br><br>
                    <u><b>${sigs.kepala_sekolah || 'M. Hidayatullah, S.Kom'}</b></u><br>
                    NIP ........................................
                </td>
                <td style="border: none; width: 50%; padding: 0; text-align: center; vertical-align: top;">
                    Guru Mata Pelajaran<br>
                    <br><br><br><br><br><br>
                    <u><b>${sigs.guru || 'Allan Parindera, S.Kom'}</b></u><br>
                    NIP ........................................
                </td>
            </tr>
        </table>
    </div>

    <div class="page-break"></div>

    <!-- RINCIAN PERTEMUAN -->
    <h3>LAMPIRAN DESAIN PEMBELAJARAN: RINCIAN PERTEMUAN</h3>
    <table style="font-size: 11px;">
        <tr class="bg-gray">
            <th width="8%" style="padding: 8px 5px;">Pertemuan</th>
            <th width="6%" style="padding: 8px 5px;">JP</th>
            <th width="26%" style="padding: 8px 5px;">Materi Spesifik (Topik)</th>
            <th width="25%" style="padding: 8px 5px;">Integrasi 5NK & DPL</th>
            <th width="35%" style="padding: 8px 5px;">Aktivitas Praktik / Output</th>
        </tr>
        ${pertemuanRows}
    </table>

    <div class="page-break"></div>

    <h2 style="font-size: 14px; text-transform: uppercase;">LAMPIRAN DOKUMEN INSTRUMEN ASESMEN & LKPD</h2>
    <hr style="border: 1px solid #000;"><br>

    ${lamp.l1_diagnostik ? `
    <table>
        <tr class="bg-gray"><td colspan="3"><b>LAMPIRAN 1: INSTRUMEN ASESMEN AWAL (DIAGNOSTIK)</b></td></tr>
        <tr><td colspan="3">${safeNL(lamp.l1_diagnostik)}</td></tr>
    </table><div class="page-break"></div>` : ''}

    ${lamp.l2_lkpd ? `
    <table>
        <tr class="bg-gray"><td colspan="2"><b>LAMPIRAN 2: LEMBAR KERJA PESERTA DIDIK (LKPD) KELOMPOK</b></td></tr>
        <tr><td colspan="2">${safeNL(lamp.l2_lkpd)}</td></tr>
    </table><div class="page-break"></div>` : ''}

    ${lamp.l3_rubrik ? `
    <table>
        <tr class="bg-gray"><td colspan="6"><b>LAMPIRAN 3: RUBRIK ASESMEN SUMATIF (KARYA AKHIR / CAPSTONE PROJECT)</b></td></tr>
        <tr><td colspan="6">${safeNL(lamp.l3_rubrik)}</td></tr>
    </table><div class="page-break"></div>` : ''}

    ${lamp.l4_materi ? `
    <h3 style="text-align: left; border-bottom: 2px solid #000; padding-bottom: 5px;">LAMPIRAN 4: RINGKASAN MATERI AJAR PENDUKUNG</h3>
    <div style="font-size: 12px; margin-top: 10px;">${safeNL(lamp.l4_materi)}</div><div class="page-break"></div>` : ''}

    ${lamp.l5_soal ? `
    <h3 style="text-align: left; border-bottom: 2px solid #000; padding-bottom: 5px;">LAMPIRAN 5: KUMPULAN SOAL ASESMEN FORMATIF & SUMATIF</h3>
    <div style="font-size: 12px; margin-top: 10px;">${safeNL(lamp.l5_soal)}</div>` : ''}

</body>
</html>`;
}

// Endpoint untuk evaluasi, review, dan koreksi RPP otomatis
app.post('/api/improve', async (req, res) => {
    const { actionType, guideline, model } = req.body;
    const selectedModel = model || "ag/gemini-3.1-pro-low";
    const currentState = getSessionState(req);
    try {
        let prompt = "";
        const customGuide = guideline ? `\nINSTRUKSI KHUSUS DARI USER (WAJIB DIIKUTI): ${guideline}\n` : "";
        
        if (actionType === 'review') {
            prompt = `Analisis data RPP saat ini: ${JSON.stringify(currentState)}.
Tinjau kesesuaian target kurikulum, integrasi nilai 5NK (Budi Luhur, Disiplin, Cinta Tanah Air, Cerdas, Terampil), serta konsistensi sintaks Kegiatan Inti (Memahami, Mengaplikasi, Merefleksi).
Berikan laporan analisis singkat, kritis, dan saran perbaikan dalam format bahasa Indonesia yang mudah dipahami.` + customGuide;
            const response = await openai.chat.completions.create({
                model: selectedModel,
                messages: [{ role: "user", content: prompt }]
            });
            return res.json({ success: true, feedback: response.choices[0].message.content });
        } else if (actionType === 'auto_fix') {
            prompt = `Koreksi dan perbaiki seluruh data RPP ini agar sesuai standar RPP 5NK SMK Kartika X-1: ${JSON.stringify(currentState)}.
Tugas Utama Anda:
1. Suntikkan nilai-nilai 5NK yang kurang.
2. Buat kegiatan belajar menjadi runut (Memahami, Mengaplikasi, Merefleksi).
3. Lengkapi bagian lampiran (l1 sampai l5) secara otomatis dengan konten detail yang relevan dengan topik pembelajaran (Jangan gunakan string kosong atau placeholder singkat). Gunakan template resmi SMK Kartika X-1:
   - l1_diagnostik: Isi dengan Instrumen Asesmen Awal (Kognitif berupa soal pilihan ganda/esai logika & Non-Kognitif tentang kesiapan laptop/minat).
   - l2_lkpd: Langkah kerja berkelompok (Integrasi 5NK - Cerdas, Terampil, Cinta Tanah Air) dengan tabel tugas eksplorasi.
   - l3_rubrik: Rubrik asesmen sumatif proyek (skala nilai 90-100, 80-89, 70-79, <70) mencakup aspek kode, analisis, presentasi, kolaborasi, dan rumus nilai akhir.
   - l4_materi: Ringkasan materi pembelajaran teoritis lengkap dari pertemuan awal hingga akhir.
   - l5_soal: Bank Soal evaluasi tertulis pilihan ganda minimal 5-10 nomor lengkap dengan kunci jawabannya.
4. Pertahankan kerangka JSON agar sesuai dengan template dasar.` + customGuide + `

Kembalikan HANYA JSON hasil perbaikan tanpa teks tambahan apapun, dengan struktur kunci persis seperti input.`;
            const response = await openai.chat.completions.create({
                model: selectedModel,
                messages: [{ role: "user", content: prompt }]
            });
            const respText = response.choices[0].message.content;
            const result = parseLLMJson(respText);
            const updated = { ...currentState, ...result };
            setSessionState(req, updated);
            return res.json({ success: true, data: updated });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Endpoint to dynamically render the HTML template based on input state (Fixes Fix 3 / Duplication)
app.post('/api/render', (req, res) => {
    const { state, config } = req.body;
    const html = buildHtml(state, config);
    res.json({ html });
});

// Fix 2: Command injection sanitization & Fix 10: Temporary file cleanup
app.post('/api/export_direct', (req, res) => {
    const { html, config } = req.body;
    const rawMargin = (config && config.margin !== undefined) ? Number(config.margin) : 20;
    
    // Validate margin as a safe integer
    if (isNaN(rawMargin) || rawMargin < 0 || rawMargin > 100) {
        return res.status(400).json({ error: "Invalid margin parameter." });
    }
    const margin = `${rawMargin}mm`;
    
    const uniqueId = uuidv4();
    const htmlPath = path.join(os.tmpdir(), `rpp_${uniqueId}.html`);
    const pdfPath = path.join(os.tmpdir(), `rpp_${uniqueId}.pdf`);
    
    fs.writeFileSync(htmlPath, html);
    
    const cmd = `wkhtmltopdf --quiet --page-size A4 --margin-top ${margin} --margin-bottom ${margin} --margin-left ${margin} --margin-right ${margin} "${htmlPath}" "${pdfPath}"`;
    
    exec(cmd, (err) => {
        if (err) {
            console.error("Direct PDF generation error:", err);
            // Cleanup HTML
            try { fs.unlinkSync(htmlPath); } catch(_) {}
            return res.status(500).json({ error: err.message });
        }
        res.sendFile(pdfPath, (sendErr) => {
            // Cleanup files after sending
            try { fs.unlinkSync(htmlPath); } catch(_) {}
            try { fs.unlinkSync(pdfPath); } catch(_) {}
            if (sendErr) {
                console.error("Error sending pdf file:", sendErr);
            }
        });
    });
});

app.post('/api/export', (req, res) => {
    const payload = req.body || {};
    const state = payload.state || getSessionState(req);
    const config = payload.config || {};
    
    const rawMargin = config.margin !== undefined ? Number(config.margin) : 20;
    if (isNaN(rawMargin) || rawMargin < 0 || rawMargin > 100) {
        return res.status(400).json({ error: "Invalid margin parameter." });
    }
    const margin = `${rawMargin}mm`;
    
    const htmlContent = buildHtml(state, config);
    const uniqueId = uuidv4();
    const htmlPath = path.join(os.tmpdir(), `rpp_${uniqueId}.html`);
    const pdfPath = path.join(os.tmpdir(), `rpp_${uniqueId}.pdf`);
    
    fs.writeFileSync(htmlPath, htmlContent);
    
    const cmd = `wkhtmltopdf --quiet --page-size A4 --margin-top ${margin} --margin-bottom ${margin} --margin-left ${margin} --margin-right ${margin} "${htmlPath}" "${pdfPath}"`;
    
    exec(cmd, (err) => {
        if (err) {
            console.error("PDF generation error:", err);
            try { fs.unlinkSync(htmlPath); } catch(_) {}
            return res.status(500).json({ error: err.message });
        }
        res.sendFile(pdfPath, (sendErr) => {
            try { fs.unlinkSync(htmlPath); } catch(_) {}
            try { fs.unlinkSync(pdfPath); } catch(_) {}
            if (sendErr) {
                console.error("Error sending pdf file:", sendErr);
            }
        });
    });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
});
