# Mach3 saha testi: air cut öncesi ayar kontrol listesi

> Tek sayfa. Sahibin Mach3 makinesinde, NittCam'in `mach3` 1.0.0 postuyla üretilen dosyayı çalıştırmadan önce yapılır.
> Kaynaklar `mach3.md` içindeki numaralarla verilmiştir ([1] Using Mach3 Mill 1.84, [2] Mach3 G/M kod referansı, diğerleri orada).
> Ayar değiştirmeden önce mevcut değerin fotoğrafını `docs/machines/<makine>/foto/` klasörüne koyun.

| # | Ayar | Mach3'te nerede | Postumuz ne varsayıyor | Ne yazmalı / ne yapmalı | Kaynak |
| --- | --- | --- | --- | --- | --- |
| 1 | Lisans / demo | Help > About; ekranda "Demo" yazısı | Dosya 500 satırdan uzun olabilir (`mixed` örneği 206 satır, gerçek plakalar daha uzun) | Demo sürüm 500 satırda durur. Lisanslı değilse büyük dosya yarıda kalır: not edin. | [3] |
| 2 | Dwell birimi | Config > General Config: "G04 Dwell param in milliseconds" kutusu | **İşaretsiz** (P saniye). `G4 P5.0` = 5 sn | İşaretliyse 5 sn yerine 5 ms bekler, spindle devrini almadan kesime girer. Kutunun durumunu yazın, değiştirmeyin; post ayarını ona göre seçeriz. | [1] 5.6.7, [2] 10.7.4 |
| 3 | IJ modu | Config > General Config, "Initial State": "I/J Mode" Inc / Absolute | Fark etmez: dosya `G91.1` yazar (artımlı IJ). | Değeri yazın. Air cut'ta yaylar dev daire çiziyorsa veya "radius differs" hatası çıkıyorsa durdurun: sürüm `G91.1` kabul etmiyor olabilir. | [1] 5.6.6, [2] 10.7.26 |
| 4 | Yay toleransı | Ayar yok (sabit) | Yaylar 4 ondalıkla yazılır | Başlangıç ve bitiş yarıçapı 0.002 mm'den fazla farklıysa Mach3 hata verir. "Radius to end of arc differs" hatası görülürse satır numarasını not edin. | [2] |
| 5 | Takım değişimi | Config > General Config, "Tool Change": Ignore Tool Change / Stop Spindle, Wait for Cycle Start / Auto Tool Changer | Post `M6` yazmaz; takım için `M0` ile durur, mesaj yorumu yazar. | Ayar bizim dosyayı etkilemez; yine de değeri yazın. Varsayılan "Ignore". M0'da spindle'ın durduğu belgelenmemiş: ilk takım durağında spindle zaten kapalı olmalı, kontrol edin. | [1] 5.6.7, [2], [6] |
| 6 | Vakum / soğutma çıkışı (M7, M8, M9) | Config > Spindle Setup, "Flood Mist Control": Mist (M7) Output #, Flood (M8) Output #, "Disable Flood/Mist Relays". Config > Ports & Pins > Output Signals: o Output #'ın pini | Profil varsayılanı: **vakum açık = `M7`, kapalı = `M9`** | M7'nin hangi Output'a, o Output'un hangi röleye, rölenin vakuma mı yağlamaya mı bağlı olduğunu yazın. Vakum M8'deyse veya hiç bağlı değilse profili değiştiririz (vakumu boş bırakmak dahil). | [1] 5.3.4, 5.3.6.1, [14] |
| 7 | Spindle kontrolü | Config > Spindle Setup: "Disable Spindle Relays", M3/M4 Output #; "Motor Control": Use Spindle Motor Output, PWM / Step-Dir; spindle start/stop delay (sn) | `M3 S18000` yazar, sonra 5 sn bekler | Röle ile açılıyorsa devir **S'den değil inverter panelinden** gelir: paneldeki devri yazın. Röle de yoksa spindle elle açılır: M3'te makine beklemez, operatör açmalı. Spindle Setup'taki start delay varsa bizim 5 sn ile toplanır (sorun değil). | [1] 5.3.6.2-5.3.6.5, [2] |
| 8 | Besleme tavanı | Config > Motor Tuning: her eksen için "Velocity" (birim/dk) ve "Accel" | Kesim F6000, dalma F1500 (mm/dk) | X, Y, Z Velocity değerlerini yazın. F bu değerden büyükse Mach3 yavaş eksene göre sınırlar; süre tahmini sapar. Z velocity < 1500 ise dalma hızını düşürürüz. Units ayarı (Config > Select Native Units) mm olmalı. | [1] 5.5.2, [15] |
| 9 | Hareket modu (CV) | Config > General Config, "Initial State": "Motion Mode" Constant Velocity (G64) / Exact Stop (G61) | Post `G64` / `G61` yazmaz; makinenin ayarı geçerli | Değeri yazın. CV açıksa köşeler hafif yuvarlanabilir; test kesiminde köşe ölçüsüne bakın. | [1] 5.6.6, 6.2.15.3 |
| 10 | Referanslama ve soft limit | Config > Homing/Limits (Soft Max/Min, Home Neg, Speed %); ekranda "Ref All Home" ve "Software Limits" düğmeleri | `G53` yalnızca takım değişim parkı açıksa yazılır | Home anahtarı var mı, açılışta "Ref All Home" yapılıyor mu yazın. Yoksa profilde park (G53) **kapalı** kalmalı. Soft limit değerlerini çalışma alanıyla karşılaştırın. | [1] 5.6.1, [2] |
| 11 | Safe Z | Config > Safe_Z Setup (değer, "Machine Coordinates" kutusu); General Config: "Use Safe_Z" | Post kendi güvenli Z'sini yazar (`G0 Z..`); Mach3 Safe Z'ye güvenmez | Mach3 Safe Z yalnızca ekrandaki "Goto Zero" gibi düğmelerde kullanılır. Referanssız makinede "Use Safe_Z" işaretsiz olmalı. Değeri not edin. | [1] 5.6.7, 6.2.15.2, [12] |
| 12 | Program sonu | Config > General Config, "Program end or M30 or Rewind" grubu | Dosya `M30` ile biter | Bu gruptaki seçenekler M30'da ofsetleri silebilir veya G92.1 uygulayabilir. İşaretli olanları yazın; ikinci plakada sıfırın kaybolmaması için önemli. | [1] 5.6.7, [2] |
| 13 | Dosya uzantısı | File > Load G-Code (Windows Aç penceresi) | `.tap` | Varsayılan filtre `.tap`. Bugün `.nc`/`.txt` kullanılıyorsa "All files" ile açılır; hangisinin kullanıldığını yazın. | [1] 6.4, [10] |
| 14 | Birimler ve başlangıç satırı | Config > General Config, "Initialization String" | Dosya başta `G21 G90 G91.1 G17 G40 G49 G54` yazar | Initialization String'i yazın. Dosya modları kendisi yazdığı için çakışma beklenmez; G54 dışındaki iş ofseti kullanılıyorsa söyleyin. | [1] 5.6.6 |
| 15 | Yorum karakterleri | Ayar yok | Yorumlar parantez içinde, ASCII, en fazla 120 karakter | Satır sınırı 256 karakter. Dosyada Türkçe harf yok; ekranda yorumlar okunuyor mu bakın. | [2] |

## Air cut sırasında gözlenecekler
1. İlk hareket Z yukarı mı (dosya `G0 Z58.5` gibi yüksek bir Z ile başlar)?
2. `M7` satırında vakum (veya bağlı olan çıkış) çalıştı mı?
3. `M0` durağında mesaj görünüyor mu, Cycle Start ile devam ediyor mu?
4. `M3 S18000` sonrası spindle döndü mü ve kesim hareketinden önce yaklaşık 5 sn beklendi mi? (Kronometre: 5 ms ise hemen geçer.)
5. Yaylar küçük ve doğru yerde mi; hata mesajı var mı?
6. Sonda Z yukarı, spindle ve vakum kapalı (`M5`, `M9`), program başa sardı mı (`M30`)?

## Sonuçların yazılacağı yer
`docs/machines/<makine>/README.md` (makine bilgi formu) ve `saha-testi.md`. Bu listedeki her satırın değeri forma "Controller" bölümüne eklenir; post ayarı buna göre `mach3` v1.x olarak güncellenir.
