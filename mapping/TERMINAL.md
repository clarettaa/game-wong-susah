# Menjalankan Robot Mapper

Buka PowerShell atau Command Prompt di folder proyek:

```powershell
cd "D:\(ubuntu)_belajar deh\mapping"
```

## Server lokal

```powershell
.\start-local.cmd
```

Alamat lokal akan terbuka otomatis di:

```text
http://localhost:8000
```

Port lain dapat diberikan sebagai argumen:

```powershell
.\start-local.cmd 3000
```

## Public tunnel

```powershell
.\start-tunnel.cmd
```

Script akan menjalankan server lokal dan membuat URL publik menggunakan LocalTunnel. URL muncul pada baris seperti:

```text
your url is: https://nama-acak.loca.lt
```

Bagikan URL tersebut hanya kepada orang yang perlu mengakses game. Pada penggunaan pertama, `npx` akan mengunduh paket `localtunnel`, sehingga koneksi internet dibutuhkan.

Port lain juga dapat digunakan:

```powershell
.\start-tunnel.cmd 3000
```

Tekan `Ctrl+C` untuk menghentikan server atau tunnel. Jika jendela server lokal dari script tunnel masih hidup, tutup jendela tersebut setelah selesai.
