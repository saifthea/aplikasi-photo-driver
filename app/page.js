"use client";

import { useState, useRef, useEffect } from "react";
import supabase from "../src/lib/supabase";
import JSZip from "jszip";
import FileSaver from "file-saver";

/* ============================================================
   Fungsi Kompresi Gambar di Browser
   - Mengubah gambar ke format JPG
   - Max lebar 1200px (rasio asli dipertahankan)
   - Kualitas 85%
   ============================================================ */
function compressImage(file, max_width = 1200, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > max_width) {
          height = Math.round((height * max_width) / width);
          width = max_width;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve({
                dataUrl: canvas.toDataURL("image/jpeg", quality),
                size: blob.size,
              });
            } else {
              reject(new Error("Gagal mengompres gambar."));
            }
          },
          "image/jpeg",
          quality
        );
      };
      img.onerror = () => reject(new Error("Gagal memuat gambar."));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Gagal membaca file."));
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatWaktu(isoString) {
  return new Date(isoString).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "";
const PHOTO_BUCKET = "foto_pengiriman";

/* ============================================================
   Helper: Download Blob dari Public URL
   ============================================================ */
async function downloadBlobFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal mengunduh: ${url}`);
  return res.blob();
}

/* ============================================================
   Helper: Build ZIP dari items (struktur: sj-xxx/foto-*.jpg)
   ============================================================ */
async function buildZipFromItems(items, onProgress) {
  const zip = new JSZip();
  let downloaded = 0;
  const total = items.reduce((sum, i) => sum + (i.foto_urls?.length || 0), 0);
  if (total === 0) throw new Error("Tidak ada foto yang dapat diunduh.");

  for (const item of items) {
    const safeSj = item.nomor_sj.replace(/[^a-zA-Z0-9_-]/g, "_");
    const folder = zip.folder(safeSj);

    if (item.foto_urls && item.foto_urls.length > 0) {
      for (let i = 0; i < item.foto_urls.length; i++) {
        const blob = await downloadBlobFromUrl(item.foto_urls[i]);
        const ext = item.foto_urls[i].split(".").pop()?.split("?")[0] || "jpg";
        folder.file(`foto-${String(i + 1).padStart(2, "0")}.${ext}`, blob);
        downloaded++;
        if (onProgress) onProgress(Math.round((downloaded / total) * 100));
      }
    }

    // Tambah summary.txt di setiap folder
    folder.file("summary.txt",
      `Nomor SJ  : ${item.nomor_sj}\nNama Driver: ${item.nama_kurir}\nDikirim Ke: ${item.dikirim_ke || "-"}\nWaktu     : ${formatWaktu(item.waktu)}\nJumlah Foto: ${item.foto_urls?.length || 0}`
    );
  }

  return zip;
}

/* ============================================================
   Helper: Filter items berdasarkan bulan
   ============================================================ */
function filterByMonth(data, monthKey) {
  if (!monthKey) return data;
  const [year, month] = monthKey.split("-").map(Number);
  return data.filter((item) => {
    const d = new Date(item.waktu);
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  });
}

/* ============================================================
   Helper: Months options generator
   ============================================================ */
function getMonthOptions(data) {
  const months = new Set();
  data.forEach((item) => {
    const d = new Date(item.waktu);
    months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  });
  return Array.from(months).sort().reverse();
}

/* ============================================================
   TAB 1: Form Input Kurir
   ============================================================ */
function FormInputKurir({ onSubmit, onReset }) {
  const [nomorSJ, setNomorSJ] = useState("");
  const [namaKurir, setNamaKurir] = useState("");
  const [dikirimKe, setDikirimKe] = useState("");
  const [photos, setPhotos] = useState([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      setError("File yang dipilih harus berupa gambar.");
      return;
    }
    setError("");
    setSuccess(false);
    setIsCompressing(true);

    let completed = 0;
    const newPhotos = [...photos];

    imageFiles.forEach((file) => {
      compressImage(file)
        .then((result) => {
          newPhotos.push({
            dataUrl: result.dataUrl,
            size: result.size,
            originalSize: file.size,
          });
          completed++;
          if (completed === imageFiles.length) {
            setPhotos(newPhotos);
            setIsCompressing(false);
          }
        })
        .catch((err) => {
          setError(err.message || "Gagal memproses gambar.");
          setIsCompressing(false);
        });
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePhoto = (index) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!nomorSJ.trim() || !namaKurir.trim()) {
      setError("Nomor Surat Jalan dan Nama Driver wajib diisi.");
      return;
    }
    if (photos.length < 2) {
      setError("Silakan upload minimal 2 foto bukti pengiriman.");
      return;
    }
    onSubmit({
      nomorSJ: nomorSJ.trim(),
      namaKurir: namaKurir.trim(),
      dikirimKe: dikirimKe.trim(),
      foto: photos,
    });
    onReset();
    setNomorSJ("");
    setNamaKurir("");
    setDikirimKe("");
    setPhotos([]);
    setError("");
    setSuccess(true);
  };

  return (
    <div className="space-y-4">
      {success && (
        <div className="flex items-center gap-2 rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          <svg className="h-5 w-5 shrink-0 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Laporan pengiriman berhasil dikirim!
        </div>
      )}

      <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm border border-slate-200 space-y-4">
        <div>
          <label htmlFor="nomorSJ" className="block text-sm font-semibold text-slate-700 mb-1.5">
            Nama Customer-SJ <span className="text-red-500">*</span>
          </label>
          <input id="nomorSJ" type="text" inputMode="text" value={nomorSJ} onChange={(e) => setNomorSJ(e.target.value)} placeholder="Contoh: SHI-5435 / Prapta-6756" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition" />
        </div>

        <div>
          <label htmlFor="namaKurir" className="block text-sm font-semibold text-slate-700 mb-1.5">
            Nama Driver <span className="text-red-500">*</span>
          </label>
          <input id="namaKurir" type="text" value={namaKurir} onChange={(e) => setNamaKurir(e.target.value)} placeholder="Contoh: Alik / Habib" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition" />
        </div>

        <div>
          <label htmlFor="dikirimKe" className="block text-sm font-semibold text-slate-700 mb-1.5">
            Dikirim Ke
          </label>
          <input id="dikirimKe" type="text" value={dikirimKe} onChange={(e) => setDikirimKe(e.target.value)} placeholder="Contoh: Cabang Jakarta Barat" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition" />
        </div>

        <div>
          <span className="block text-sm font-semibold text-slate-700 mb-1.5">
            Foto Bukti Pengiriman <span className="text-red-500">*</span>
          </span>
          <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 cursor-pointer text-center hover:border-blue-400 hover:bg-blue-50 transition">
            <svg className="h-10 w-10 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-sm font-medium text-slate-600">
              {isCompressing ? "Mengompres foto..." : "Pilih minimal 2 foto dari galeri"}
            </span>
            <span className="text-xs text-slate-400">Foto otomatis dikompres (JPG, maks 1200px, kualitas 85%)</span>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />
          </label>
        </div>

        {photos.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">
                Preview ({photos.length} foto) — Sudah Dikompres
              </p>
              <span className={`text-xs font-medium ${photos.length < 2 ? "text-amber-600" : "text-green-600"}`}>
                {photos.length < 2 ? `Kurang ${2 - photos.length} foto (minimal 2)` : "Lengkapi terpenuhi"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {photos.map((p, idx) => (
                <div key={idx} className="relative group">
                  <img src={p.dataUrl} alt={`Preview ${idx + 1}`} className="w-full h-40 object-cover rounded-lg bg-white" />
                  <button type="button" onClick={() => removePhoto(idx)} className="absolute top-1 right-1 h-7 w-7 flex items-center justify-center rounded-full bg-red-500 text-white text-sm font-bold opacity-0 group-hover:opacity-100 transition">
                    x
                  </button>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Ukuran: {formatSize(p.size)}
                    {p.originalSize && (
                      <span className="text-green-600">
                        {" "}
                        (hemat {Math.max(0, 100 - Math.round((p.size / p.originalSize) * 100))}%)
                      </span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            <svg className="h-5 w-5 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        <button type="submit" disabled={isCompressing} className="w-full rounded-xl bg-blue-600 px-4 py-3.5 text-base font-semibold text-white shadow-md hover:bg-blue-700 active:scale-[0.99] transition disabled:opacity-50 disabled:cursor-not-allowed">
          {isCompressing ? "Memproses..." : "Kirim Laporan Pengiriman"}
        </button>
      </form>
    </div>
  );
}

/* ============================================================
   TAB 2: Cari Data (Kantor / Admin)
   ============================================================ */
function CariData({ data, onDelete, onRefresh }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState([]);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // State Lightbox
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState("");
  const [lightboxAlt, setLightboxAlt] = useState("");

  // State Download
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadMsg, setDownloadMsg] = useState("");
  const [monthKey, setMonthKey] = useState("");
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [downloadMode, setDownloadMode] = useState(""); // "selected" | "all" | "month"
  const [downloadPasswordInput, setDownloadPasswordInput] = useState("");
  const [downloadPasswordError, setDownloadPasswordError] = useState("");

  // Reset search bar setiap modal dibuka/ditutup agar nilai lama tidak terlihat
  useEffect(() => {
    if (showPasswordModal) setQuery("");
  }, [showPasswordModal]);

  // Kunci scroll body + tombol Escape saat lightbox terbuka
  useEffect(() => {
    if (!lightboxOpen) return;
    const handleKey = (e) => {
      if (e.key === "Escape") closeLightbox();
    };
    document.addEventListener("keydown", handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightboxOpen]);

  const hasil = data.filter((item) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return item.nomor_sj.toLowerCase().includes(q) || item.nama_kurir.toLowerCase().includes(q);
  });

  const itemsByMonth = monthKey ? filterByMonth(data, monthKey) : hasil;

  const toggleSelect = (id) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    setSelected(selected.length === hasil.length ? [] : hasil.map((i) => i.id));
  };

  const openLightbox = (url, alt) => {
    setLightboxImage(url);
    setLightboxAlt(alt);
    setLightboxOpen(true);
  };

  const closeLightbox = () => {
    setLightboxOpen(false);
    setLightboxImage("");
    setLightboxAlt("");
  };

  const openDeleteModal = () => {
    if (selected.length === 0) return;
    setQuery("");
    setPasswordInput("");
    setPasswordError("");
    setShowPasswordModal(true);
  };

  const handleConfirmDelete = () => {
    if (!ADMIN_PASSWORD) {
      setPasswordError("Password admin belum diatur. Isi NEXT_PUBLIC_ADMIN_PASSWORD di file .env.local lalu restart server.");
      return;
    }
    if (passwordInput === ADMIN_PASSWORD) {
      const count = selected.length;
      onDelete(selected);
      setSelected([]);
      setQuery("");
      setShowPasswordModal(false);
      setSuccessMsg(`${count} data berhasil dihapus.`);
      setTimeout(() => setSuccessMsg(""), 3000);
    } else {
      setPasswordError("Password salah! Silakan coba lagi.");
    }
  };

  // ─────────────────────────────────────────────────────────────
  // DOWNLOAD LOGIC
  // ─────────────────────────────────────────────────────────────

  const getItemsForDownload = (mode) => {
    if (mode === "all") return data;
    if (mode === "month") return itemsByMonth;
    return hasil.filter((i) => selected.includes(i.id));
  };

  const openDownloadModal = (mode) => {
    const items = getItemsForDownload(mode);
    if (items.length === 0) {
      setDownloadMsg("Tidak ada data untuk diunduh.");
      return;
    }
    const totalPhotos = items.reduce((s, i) => s + (i.foto_urls?.length || 0), 0);
    if (totalPhotos === 0) {
      setDownloadMsg("Data pilihan tidak memiliki foto. Foto wajib ada untuk membuat ZIP.");
      return;
    }
    setDownloadMode(mode);
    setDownloadPasswordInput("");
    setDownloadPasswordError("");
    setDownloadMsg("");
    setShowDownloadModal(true);
  };

  const handleConfirmDownload = async () => {
    if (!ADMIN_PASSWORD) {
      setDownloadPasswordError("Password admin belum diatur. Isi NEXT_PUBLIC_ADMIN_PASSWORD di file .env.local lalu restart server.");
      return;
    }
    if (downloadPasswordInput !== ADMIN_PASSWORD) {
      setDownloadPasswordError("Password salah! Silakan coba lagi.");
      return;
    }

    setShowDownloadModal(false);
    setDownloadLoading(true);
    setDownloadProgress(0);
    setDownloadMsg("Mengunduh foto dari server...");

    try {
      const items = getItemsForDownload(downloadMode);
      const zip = await buildZipFromItems(items, (pct) => {
        setDownloadProgress(pct);
      });
      setDownloadMsg("Membuat file ZIP...");

      const modeLabels = { selected: "Terpilih", all: "Semua", month: monthKey };
      const zipName = `bukti_pengiriman_${modeLabels[downloadMode]}_${Date.now()}.zip`;
      const blob = await zip.generateAsync({ type: "blob" });
      FileSaver.saveAs(blob, zipName);

      setDownloadMsg(`✅ ${zipName} berhasil didownload! (${items.length} SJ)`);
      setTimeout(() => setDownloadMsg(""), 5000);
    } catch (err) {
      console.error("Download error:", err);
      setDownloadMsg(`❌ Gagal: ${err.message}`);
    } finally {
      setDownloadLoading(false);
      setDownloadProgress(0);
    }
  };

  return (
    <div className="space-y-4">
      {/* Notifikasi sukses hapus */}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          <svg className="h-5 w-5 shrink-0 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {successMsg}
        </div>
      )}

      {/* Notifikasi download */}
      {downloadMsg && (
        <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${downloadMsg.startsWith("❌") ? "bg-red-50 border-red-200 text-red-700" : downloadMsg.startsWith("✅") ? "bg-green-50 border-green-200 text-green-800" : "bg-blue-50 border-blue-200 text-blue-700"}`}>
          <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={downloadMsg.startsWith("❌") ? "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" : "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"} />
          </svg>
          <span className="flex-1">{downloadMsg}</span>
          {downloadLoading && (
            <div className="h-2 w-24 rounded-full bg-blue-200 overflow-hidden">
              <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${downloadProgress}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Search Bar — sembunyikan saat modal password terbuka */}
      <div className={`relative transition-all duration-200 ${showPasswordModal || showDownloadModal ? "opacity-0 pointer-events-none" : "opacity-100"}`}>
        <svg className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari Nama Customer/SJ..." autoComplete="off" className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-base shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition" />
      </div>

      {/* Filter Bulan */}
      <div className={`rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center gap-3 transition-all duration-200 ${showPasswordModal || showDownloadModal ? "opacity-0 pointer-events-none" : "opacity-100"}`}>
        <label className="text-sm font-semibold text-slate-700 shrink-0">Filter Bulan:</label>
        <select value={monthKey} onChange={(e) => { setMonthKey(e.target.value); setSelected([]); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200">
          <option value="">Semua Bulan</option>
          {getMonthOptions(data).map((m) => (
            <option key={m} value={m}>{new Date(m + "-01").toLocaleDateString("id-ID", { month: "long", year: "numeric" })}</option>
          ))}
        </select>
        {monthKey && (
          <button onClick={() => { setMonthKey(""); setSelected([]); }} className="text-xs text-slate-400 hover:text-slate-600 underline shrink-0">Reset</button>
        )}
      </div>

      {/* Info hasil + aksi select & download — sembunyikan saat modal terbuka */}
      <div className={`flex flex-wrap items-center justify-between gap-2 transition-all duration-200 ${showPasswordModal || showDownloadModal ? "opacity-0 pointer-events-none" : "opacity-100"}`}>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={itemsByMonth.length > 0 && selected.length === itemsByMonth.filter(i => hasil.includes(i)).length} onChange={toggleSelectAll} className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
          <span className="text-sm text-slate-600">Pilih semua ({itemsByMonth.length} dari {data.length})</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onRefresh} className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm hover:bg-slate-50 active:scale-[0.98] transition">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
          {selected.length > 0 && (
            <>
              <button type="button" onClick={() => openDownloadModal("selected")} className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 active:scale-[0.98] transition">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download Terpilih ({selected.length})
              </button>
              <button type="button" onClick={openDeleteModal} className="flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 active:scale-[0.98] transition">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Hapus ({selected.length})
              </button>
            </>
          )}
          <button type="button" onClick={() => openDownloadModal("all")} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 active:scale-[0.98] transition">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download Semua
          </button>
          {(() => {
            const monthItems = monthKey ? filterByMonth(data, monthKey) : null;
            if (!monthItems || monthItems.length === 0) return null;
            return (
              <button type="button" onClick={() => openDownloadModal("month")} className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 active:scale-[0.98] transition">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Download Bulan Ini ({monthItems.length})
              </button>
            );
          })()}
        </div>
      </div>

      {/* Daftar Hasil */}
      {itemsByMonth.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-500 shadow-sm">
          <svg className="mx-auto h-10 w-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <p className="mt-2 font-medium">{query ? `Tidak ada hasil untuk "${query}"` : "Belum ada data pengiriman."}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {itemsByMonth.map((item) => {
            const isSelectable = hasil.some(h => h.id === item.id);
            return (
              <div key={item.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {/* Foto */}
                {item.foto_urls && item.foto_urls.length > 0 ? (
                  <div className="grid grid-cols-2 gap-1">
                    {item.foto_urls.map((f, i) => (
                      <button key={i} type="button" onClick={() => openLightbox(f, `Bukti ${i + 1} - ${item.nomor_sj}`)} className="group relative overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <img src={f} alt={`Bukti ${i + 1} - ${item.nomor_sj}`} className="h-40 w-full object-cover transition-transform duration-200 group-hover:scale-105" />
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-200 group-hover:bg-black/20">
                          <svg className="h-6 w-6 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 10l3 3m0 0l-3 3m3-3l-3-3m3 3V7" />
                          </svg>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-44 w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
                    <div className="text-center">
                      <svg className="mx-auto h-10 w-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <p className="mt-1 text-xs text-slate-400">Belum ada foto</p>
                    </div>
                  </div>
                )}
                {/* Detail */}
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {isSelectable && (
                        <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggleSelect(item.id)} className="h-5 w-5 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500" aria-label={`Pilih data ${item.nomor_sj}`} />
                      )}
                      <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{item.nomor_sj}</span>
                    </div>
                    <span className="text-xs text-slate-400">{formatWaktu(item.waktu)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <p className="text-sm font-semibold text-slate-800">{item.nama_kurir}</p>
                  </div>
                  {item.dikirim_ke && (
                    <div className="flex items-center gap-2">
                      <svg className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.591 5.591a2 2 0 012.828 0l2.582 2.582a2 2 0 010 2.828l-1.586 1.586-2.582-2.582 1.586-1.586zM3 7a2 2 0 012-2h6a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                      </svg>
                      <p className="text-sm text-slate-600">{item.dikirim_ke}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Konfirmasi Hapus */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowPasswordModal(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
                <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">Konfirmasi Hapus Data</h3>
                <p className="text-xs text-slate-500">{selected.length} data akan dihapus permanen.</p>
              </div>
            </div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Password Admin</label>
            <input type="password" inputMode="numeric" autoFocus value={passwordInput} onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(""); }} onKeyDown={(e) => { if (e.key === "Enter") handleConfirmDelete(); }} placeholder="Masukkan password admin" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition" />
            {passwordError && <p className="mt-1.5 text-xs font-medium text-red-600">{passwordError}</p>}
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setShowPasswordModal(false)} className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">Batal</button>
              <button type="button" onClick={handleConfirmDelete} className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white shadow-md hover:bg-red-700 active:scale-[0.99] transition">Hapus Data</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Download */}
      {showDownloadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowDownloadModal(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100">
                <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">Konfirmasi Download ZIP</h3>
                <p className="text-xs text-slate-500">
                  {downloadMode === "selected" && `${selected.length} data terpilih`}
                  {downloadMode === "all" && `Semua data (${data.length})`}
                  {downloadMode === "month" && `Data bulan ${monthKey}`}
                </p>
              </div>
            </div>
            {downloadMsg && !downloadMsg.startsWith("✅") && !downloadMsg.startsWith("❌") && (
              <div className="mb-3 rounded-xl bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-700">
                {downloadMsg}
                <div className="mt-2 h-1.5 rounded-full bg-blue-200 overflow-hidden">
                  <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${downloadProgress}%` }} />
                </div>
              </div>
            )}
            {!downloadLoading && (
              <>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Password Admin</label>
                <input type="password" inputMode="numeric" autoFocus value={downloadPasswordInput} onChange={(e) => { setDownloadPasswordInput(e.target.value); setDownloadPasswordError(""); }} onKeyDown={(e) => { if (e.key === "Enter") handleConfirmDownload(); }} placeholder="Masukkan password admin" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition" />
                {downloadPasswordError && <p className="mt-1.5 text-xs font-medium text-red-600">{downloadPasswordError}</p>}
              </>
            )}
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setShowDownloadModal(false)} disabled={downloadLoading} className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition disabled:opacity-50">Batal</button>
              <button type="button" onClick={handleConfirmDownload} disabled={downloadLoading} className="flex-1 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-md hover:bg-blue-700 active:scale-[0.99] transition disabled:opacity-50 disabled:cursor-not-allowed">
                {downloadLoading ? "Memproses..." : "Konfirmasi Download"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Preview Gambar */}
      {lightboxOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-3 sm:p-6" onClick={closeLightbox} role="dialog" aria-modal="true" aria-label={lightboxAlt}>
          {/* Tombol Tutup */}
          <button type="button" onClick={closeLightbox} className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/25 active:scale-95" aria-label="Tutup pratinjau">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {/* Gambar besar */}
          <div className="relative flex max-h-full max-w-full items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <img src={lightboxImage} alt={lightboxAlt} className="max-h-[90vh] max-w-full rounded-lg object-contain shadow-2xl select-none" />
          </div>
          {/* Label keterangan */}
          {lightboxAlt && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-4 py-1.5 text-center text-xs text-white backdrop-blur sm:text-sm">
              {lightboxAlt}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Halaman Utama
   ============================================================ */
export default function Home() {
  const [activeTab, setActiveTab] = useState("kurir");
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Fetch data dari Supabase saat tab admin dibuka
  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: rows, error } = await supabase
        .from("pengiriman")
        .select("*")
        .order("waktu", { ascending: false });

      if (error) throw error;
      setData(rows || []);
    } catch (err) {
      console.error("Gagal memuat data:", err);
      // Jika tabel belum dibuat, set data kosong
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleKirim = async (newItem) => {
    setSubmitting(true);
    setSubmitError("");
    setSubmitSuccess(false);

    try {
      // Upload foto ke Supabase Storage
      const fotoUrls = [];
      for (const photo of newItem.foto) {
        // Convert dataUrl ke Blob
        const response = await fetch(photo.dataUrl);
        const blob = await response.blob();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(fileName, blob, { contentType: "image/jpeg" });

        if (uploadError) throw uploadError;

        // Ambil public URL
        const { data: urlData } = supabase.storage
          .from(PHOTO_BUCKET)
          .getPublicUrl(fileName);

        fotoUrls.push(urlData.publicUrl);
      }

      // Insert ke database
      const { data: insertData, error: insertError } = await supabase
        .from("pengiriman")
        .insert({
          nomor_sj: newItem.nomorSJ,
          nama_kurir: newItem.namaKurir,
          dikirim_ke: newItem.dikirimKe || null,
          foto_urls: fotoUrls,
          waktu: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError) throw insertError;

      setSubmitSuccess(true);
      setTimeout(() => setSubmitSuccess(false), 3000);
      // Refresh data
      fetchData();
    } catch (err) {
      console.error("Gagal mengirim:", err);
      setSubmitError(err.message || "Gagal mengirim laporan. Silakan coba lagi.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleHapus = async (ids) => {
    try {
      // Ambil foto-foto yang akan dihapus
      const { data: itemsToDelete } = await supabase
        .from("pengiriman")
        .select("id, foto_urls")
        .in("id", ids);

      // Hapus foto dari storage
      const allFiles = (itemsToDelete || []).flatMap((item) => item.foto_urls || []);
      const filesToPath = allFiles
        .filter(Boolean)
        .map((url) => url.split('/').pop()) // ambil filename dari URL publik
        .filter(Boolean);

      if (filesToPath.length > 0) {
        const { error: removeError } = await supabase.storage
          .from(PHOTO_BUCKET)
          .remove(filesToPath);
        if (removeError) console.warn("Gagal menghapus beberapa foto:", removeError);
      }

      // Hapus dari database
      const { error: deleteError } = await supabase
        .from("pengiriman")
        .delete()
        .in("id", ids);

      if (deleteError) throw deleteError;

      // Refresh data
      fetchData();
    } catch (err) {
      console.error("Gagal menghapus:", err);
      alert("Gagal menghapus data: " + err.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-700 to-blue-500 px-4 py-5 shadow-md">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20">
            <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7h8a2 2 0 012 2v6a2 2 0 01-2 2h-1l-2 2h-4l-2-2H8a2 2 0 01-2-2V9a2 2 0 012-2z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 11a1 1 0 100-2 1 1 0 000 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-white leading-tight">
              Botamp.id - System Bukti Pengiriman Driver
            </h1>
            <p className="text-xs sm:text-sm text-blue-100">
              Photo Bukti Pengiriman Driver
            </p>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="sticky top-0 z-10 border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-3xl">
          <button onClick={() => setActiveTab("kurir")} className={`flex-1 px-2 py-3.5 text-sm font-semibold transition ${activeTab === "kurir" ? "border-b-[3px] border-blue-600 text-blue-700" : "border-b-[3px] border-transparent text-slate-500 hover:text-slate-700"}`}>
            Form Input Driver
          </button>
          <button onClick={() => setActiveTab("admin")} className={`flex-1 px-2 py-3.5 text-sm font-semibold transition ${activeTab === "admin" ? "border-b-[3px] border-blue-600 text-blue-700" : "border-b-[3px] border-transparent text-slate-500 hover:text-slate-700"}`}>
            Cari Data (Kantor/Admin)
          </button>
        </div>
      </nav>

      {/* Konten */}
      <main className="mx-auto max-w-3xl px-4 py-5 pb-16">
        {activeTab === "kurir" ? (
          <div className="space-y-4">
            {submitSuccess && (
              <div className="flex items-center gap-2 rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
                <svg className="h-5 w-5 shrink-0 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Laporan berhasil dikirim ke Supabase!
              </div>
            )}
            {submitError && (
              <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                <svg className="h-5 w-5 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {submitError}
              </div>
            )}
            <FormInputKurir onSubmit={handleKirim} onReset={() => {}} />
          </div>
        ) : (
          <div className="space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600"></div>
                  <p className="text-sm text-slate-500">Memuat data...</p>
                </div>
              </div>
            ) : (
              <CariData data={data} onDelete={handleHapus} onRefresh={fetchData} />
            )}
            </div>
        )}
      </main>
    </div>
  );
}
