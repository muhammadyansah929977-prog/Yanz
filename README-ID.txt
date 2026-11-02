WA BUSINESS ANTI SPAM — STARTER BACKEND
======================================

ISI PROYEK
- server.js       Backend Node.js + Express
- public/         Folder tampilan web
- .env.example   Contoh konfigurasi rahasia (JANGAN isi rahasia di HTML)
- package.json   Daftar dependensi dan perintah start

PENTING
1. Proyek ini adalah starter yang harus dipasang di server Node.js dengan HTTPS.
2. Acode Preview hanya menampilkan HTML; ia tidak menjalankan server Node.js.
3. Jangan menaruh token Meta di index.html, chat, atau GitHub.
4. Jangan isi kredensial Meta sampai nomor benar-benar siap di Cloud API dan status koneksinya jelas.
5. Endpoint kirim hanya mengirim SATU template yang disetujui Meta kepada satu pelanggan yang masih opt-in setiap permintaan. Tidak ada blast massal otomatis.
6. Template yang disimpan harus nama template yang sudah disetujui Meta; contoh nama bukan berarti sudah disetujui.
7. Sebelum produksi, ganti penyimpanan session MemoryStore dengan session store persisten, gunakan HTTPS, atur backup database, batasi akses admin, dan lakukan uji keamanan.
8. Jangan pindahkan atau deregister nomor WhatsApp Business yang masih dipakai sebelum memastikan opsi coexistence resmi tersedia untuk akun tersebut.

MENJALANKAN DI SERVER NODE.JS
1. Upload folder proyek ke hosting Node.js yang mendukung Node 20+.
2. Jalankan: npm install
3. Salin .env.example menjadi .env.
4. Isi SESSION_SECRET (acak panjang minimal 32 karakter) dan ADMIN_PASSWORD yang kuat.
5. Jalankan: npm start
6. Buka URL HTTPS hosting. Endpoint /api/health menunjukkan server aktif.
7. Setelah konfigurasi Cloud API sah dan siap, isi META_GRAPH_VERSION, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET, dan WHATSAPP_VERIFY_TOKEN di pengaturan environment hosting, bukan di HTML.

CATATAN KEAMANAN
Starter ini belum layak dianggap sistem produksi. Express MemoryStore dipakai sebagai default sederhana dan harus diganti dengan session store persisten pada hosting multi-instance/produksi. Tambahkan perlindungan CSRF sesuai model deployment sebelum membuka panel untuk internet umum.
