# Makine bilgi formu: <makine adı>

Spec §12.3. Saha testinden önce her makine için bu klasörü kopyalayın: `docs/machines/<makine-adı>/`.
Doldurulan form ve dosyalar post ayarının ve makine profilinin kaynağıdır. Uygulamadaki yazdırılabilir
kontrol listesi: Makineler → makine → Doğrulama → **Saha testi kiti** (`/makineler/<id>/saha-kiti`).

## 1. Çalışan NC dosyaları (en önemlisi)
Makinede bugün sorunsuz çalışan 2–3 dosyayı `ornek-nc/` klasörüne koyun (USB'den olduğu gibi, adını değiştirmeden).

| Dosya | Hangi CAM / post üretti | Ne kesiyor | Not |
| --- | --- | --- | --- |
| | | | |

## 2. Controller
- Marka / model:
- Yazılım sürümü:
- Fotoğraflar (`foto/`): ekran, etiket
- Dosya uzantısı (`.tap`, `.nc`, `.cnc`, ...):
- Dosya adı sınırı (karakter), Türkçe karakter kabul ediyor mu:
- Dosya boyutu sınırı:
- Yay (G2/G3) destekliyor mu; I/J mi R mi:
- Satır numarası (N) gerekli mi:
- Delik döngüsü (G81/G83) destekliyor mu:

## 3. Takımlar
| No | Çap (mm) | Tip (düz, sıkıştırmalı, ...) | Ağız | Malzeme | Devir (rpm) | Besleme (mm/dk) | Dalma (mm/dk) | Paso (mm) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | |

- Takım değişimi: otomatik / elle / yok
- Takım boyu ölçer var mı:
- Elle takım değişiminde makine nerede duruyor (park konumu var mı):

## 4. Sıfırlar ve tabla
- Program sıfırı (X/Y) hangi köşe:
- X+ ve Y+ yönü:
- Z sıfırı: tabla yüzeyi / malzeme üstü; nasıl alınıyor:
- Tabla ölçüsü (mm) ve eksen hareket sınırları (X, Y, Z):
- Tabla tutma: vakum / mengene / T-kanal; fire tabla (spoilboard) kalınlığı:
- Spindle en yüksek devir; devir programdan mı, elle mi:
- Vakum M kodu (makinede bağlandığı gibi; açma ve kapama, ör. M7 / M9 veya M10 / M11):
- Soğutma çıkışı var mı (sis / sıvı / hava); hangi M kodu açıp kapatıyor (vakumla aynı kod olmamalı):
- Mengene veya kenar kıskacı kullanılıyorsa en yüksek noktasının tabladan yüksekliği (mm):
- Spindle pens (collet) ölçüsü ve tipi (ör. ER20, 1/4" / 6 / 8 mm):

## 5. Bugünkü yazılım
- Şu an kullanılan CAM yazılımı ve post processor:
- MDF ve melaminde kullanılan devir ve besleme:

## 6. Saha testi sonuçları
`saha-testi.md` dosyasına yazın (tarih, operatör, kit sayfasındaki adımlar, ölçü formu, sorunlar).
