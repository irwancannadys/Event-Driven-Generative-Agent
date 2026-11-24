# 016: Visual 3D primitif lewat createAvatar

Status: diterima (2026-11-24). Asal: diskusi review Tahap 0.

## Keputusan
Versi 1 memakai 3D primitif (kotak, silinder, bola) dengan warna per peran dan label. Karakter dibuat lewat `createAvatar(role)` yang mengembalikan objek 3D dan `play(status)`. Mode "tanpa 3D" (hanya panel) tetap ada.

## Alasan
Fokus pada agent, bukan modeling. Dengan satu pintu penghubung, mengganti primitif jadi model `.glb` berarti mengganti isi satu fungsi, bukan menulis ulang.

## Konsekuensi
- Animasi sederhana versi primitif akan dibuang saat upgrade. Itu kecil.
- Aset model harus gratis dan lisensinya dicek (bahan kursus). Belum dicek.
- Urutan tahap tidak berubah: 3D baru di Tahap 4.
