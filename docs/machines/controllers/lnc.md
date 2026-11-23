# LNC (LNC Technology / Advantech-LNC, Tayvan)
> Durum: araştırma notu, makinede doğrulanmadı. Güven: orta (G-kod sözdizimi LNC-MILL Programming Manual V04.00.004 (2010) kaynaklı; MW ahşap serisi için yalnız operasyon kılavuzu açılabildi, ahşaba özel programlama kılavuzu açılamadı).

## Özet (post yazacak kişi için)
- LNC-MILL dili Fanuc tarzı ISO: `G20/G21` (Syntec'teki gibi G70/G71 değil), G90/G91, G54..G59 + `G54 P1..P300` ek koordinatlar [1].
- Yay: I/J/K başlangıç noktasından merkeze **artımlı**. R verilirse IJK yerine R kullanılır. Başlangıç ve bitiş yarıçapı farkı yaklaşık 5 mikron üstündeyse alarm verir [1]. Kod listesinde G90.1/G91.1 yok [1].
- Dwell: `G04 X_` saniye (0.001-99999.999), `G04 P_` ms (nokta yasak, 1-99999999) [1]. Delik döngülerinde de P = 1/1000 s, noktasız [1].
- Takım değişimi: Fusion LNC postu `T.. M06` kullanıyor [3]. Kılavuz tablosunda M06 = otomatik takım değişimi [1]. Uzunluk telafisi `G43 H_`, H 1-99, `G49` iptal [1].
- **G53 önceki takım telafisini otomatik iptal eder** [1]. G53'ten sonra G43'ü yeniden yaz.
- Yorum: kılavuzun belgelediği tek yorum sözdizimi `/* ... */` [1]. Fusion LNC postu ise `( ... )` yazıyor [3]. İkisi de kullanılabilir görünüyor ama `( )` makinede doğrulanmalı.
- MW ahşap serisinde vakum, bölge vakumu, pozisyonlama pimleri ve toz davlumbazı **parametreyle atanan** M-kodları. Fabrika varsayılanları: vakum pompası 1 M10/M11, adsorpsiyon 1 M90/M91, adsorpsiyon 2 M96/M97, **pozisyonlama 1 M8/M9**, davlumbaz M140/M141 [2]. Dikkat: bu makinelerde M08 soğutma değil, pozisyonlama pimi olabilir.

## Sürümler / donanım
- Freze dili: LNC-MILL Series Programming Manual V04.00.004, 2010/11 [1]. MW ahşap kontrolcüleri (MW2200, MW2800, MW2900, MW5800) için MW Woodworking Machine System Operation Manual V1.1 [2]. Bu kılavuz yalnız ekran, dosya yönetimi ve fonksiyon parametrelerini anlatıyor, G-kodu anlatmıyor.
- "Advantech LNC Milling Machine Series Programming Manual V01.02.000" adlı daha yeni bir programlama kılavuzu var [5] (arama özeti, belge açılamadı). V04 ile farkları bilinmiyor.
- Türkiye'deki yaygınlık için kaynak yok. MW serisi nesting ve ebatlama hatlarına yönelik: otomatik yükleme-boşaltma M15/M16/M17 makroları, çoklu delik kafası T21-T61 numaralandırması [2].

## 1. Program dosyası
- Fusion LNC postu: ilk satırda `%`, sonra `O####` (program adı tam sayı olmalı), uzantı `.nc`, kod sayfası ASCII, sonda `%` [3].
- Kılavuzda program numaraları `O0001` biçiminde; makrolar O numarasıyla çağrılıyor (`G65 P1000` = O1000) [1].
- MW'de dosyalar USB'den (U-disk import/export ekranı) veya ağ paylaşımından içe alınıyor. Barkod okuyucuyla dosya açma var: dosya adı barkoddan geliyor [2]. Dosya adı uzunluğu, uzantı kuralı, satır sonu ve boyut sınırı: **bilinmiyor**.
- N numaraları isteğe bağlı (Fanuc tarzı). Kesin sınır kaynakta yok.

## 2. Başlangıç modal durumu ve güvenli giriş
- G21 seçilince en küçük birim 0.001 mm [1]. Açılış düzlemi parametre #0145 ile seçiliyor [1].
- Fusion LNC postu birim olarak `G21`/`G20` yazıyor [3].
- Önerilen giriş: `G21` / `G90 G94 G17 G40 G49 G80` / `G54`.

## 3. Hareket
- G00 eksen hareketleri; G53 hareketi varsayılan olarak eşzamansız (eksen eksen), parametre #0041 ile eşzamanlı yapılabiliyor [1].
- G02/G03: G17 için IJ, G18 için IK, G19 için JK; I/J/K artımlı, merkezden başlangıca değil **başlangıçtan merkeze**. R ve IJK birlikte yazılırsa R geçerli. Yarıçap farkı yaklaşık 5 mikronu aşarsa alarm [1].
- Helis: G02/G03 "circular/helical" olarak tanımlı [1].
- G90.1/G91.1: listede yok [1]. G61 tam duruş, G64 kesme modu var [1].
- Noktasız sayının (ör. `X10`) mm mi yoksa 0.001 mm mi okunduğu kılavuzda açık değil. Kılavuz örneklerinin hepsi noktalı (`G00 X10.`, `G43 G00 H01 Z150.`) [1]. Post her zaman nokta yazmalı.

## 4. Besleme ve spindle
- F mm/dak (G94) [1]. S devir/dak, M03/M04/M05 [1][3].
- Dwell: `G04 X2.5` = 2.5 s, `G04 P2500` = 2.5 s; noktasız P ms. `G04` tek başına G09 gibi tam duruş yapar [1]. Fusion postu `G94 G04 P<ms>` yazıyor [3].

## 5. Takım değişimi
- `T<n> M06` [1][3]. ATC davranışı makine makrosuna bağlı. MW'de matkap kafası takımları T21-T40 dik matkap, T41-T60 yatay matkap, T61 testere [2].
- Uzunluk telafisi `G43 H<n>` (Z ile aynı blokta olabilir: `G43 G00 H01 Z150.`), `G44`, `G49`; H0 her zaman 0 [1].
- MW otomatik takım ayarı: "çok takım, çok iş" modunda yalnız ilk takımın Z düşüşü elle ayarlanıyor; koordinat sistemi varsayılan G54 [2].
- ATC'siz makinede M06'nın davranışı: **makine üreticisine bağlı**. Manuel değişimde M00 kullan.

## 6. Koordinatlar
- G54..G59; `G10 L20 P1..P300` ile ek iş koordinatları ayarlanır, programda `G54 P1..P300` [1]. Fanuc'taki `G54.1 P` yazımı belgede yok (bilinmiyor).
- G53: makine koordinatı, tek blok, yalnız G90; **takım telafisini iptal eder** [1].
- G28/G29/G30 referans dönüşleri var [1].

## 7. Yardımcı çıkışlar
- Genel freze tablosu: M08/M09 soğutma, M19 spindle yönlendirme [1].
- MW ahşap serisi (parametre numarası: varsayılan M kodu) [2]:
  - 9412/9413 vakum pompası 1 açık/kapalı: M10/M11; 9414/9415 vakum pompası 2: M20/M21
  - 9408/9409 adsorpsiyon 1: M90/M91; 9410/9411 adsorpsiyon 2: M96/M97
  - 9400/9401 pozisyonlama 1: M8/M9; 9402/9403 pozisyonlama 2: M18/M19; 9404-9407 pozisyonlama 3/4: M61/M62, M63/M64; 9456/9457 pozisyonlama 5: M36/M37
  - 9438-9445 spindle 1-4 davlumbaz yukarı/aşağı: M140/M141, M142/M143, M144/M145, M146/M147
- Bu kodlar parametre olduğu için makineden makineye değişebilir: makine profili kullanıcıdan almalı. Fabrika varsayılanı olarak yukarıdakiler önerilebilir, "doğrula" etiketiyle.

## 8. Delik döngüleri ve alt programlar
- G73, G74, G76, G80-G89, G98/G99 Fanuc tarzı. Dipte bekleme P ms ve noktasız [1].
- Çoklu delik ve cep döngüleri (G100 sonrası, LNC'ye özel makrolar) var [1]. NittCam kullanmamalı.
- Alt program `M98 P_`, `M99`; makro `G65 P_ L_`, modal `G66/G67`; makro dili `#` değişkenleri, `IF ... GOTO`, `$` sistem değişkenleri [1].

## 9. Yorumlar ve karakterler
- Kılavuz: `/* ... */` arası yok sayılır; satır içinde de kullanılabilir (`G00 X10. /* not */;`) [1].
- Fusion postu `( ... )`, büyük harf, `A-Z 0-9 . , = _ -` ve boşluk, en fazla 80 karakter [3].
- Türkçe karakter: kaynak yok, ASCII ile sınırla.

## 10. Bilinen tuzaklar
- MW'de M08, varsayılan olarak "pozisyonlama 1" (pim veya itici) [2]. Mach3 postundaki gibi soğutma/vakum için M7/M8/M9 yazmak yanlış donanımı çalıştırabilir.
- G53'ten sonra takım boyu telafisi kalkar [1].
- Yay yarıçap toleransı dar (yaklaşık 5 mikron) [1]. Post yay merkezini yeterli hassasiyetle yazmalı (en az 3 ondalık).
- Forum kaynaklı LNC raporu bu araştırmada açılmadı.

## 11. Minimal güvenli program
Türetilmiş, makinede denenmedi. 100x100 mm kare, köşeleri R5, ATC yok, vakum makine profilinden (burada MW varsayılanı M10/M11 örnek olarak).
```
%
O0001 (NITTCAM LNC TEST)
G21
G90 G94 G17 G40 G49 G80
G54
G0 Z50.
M10
(TAKIM T1 D6 TAKILI MI)
M00
G0 Z50.
S18000 M03
G04 P5000
G0 X10. Y5.
G1 Z-3. F500.
G1 X100. F2000.
G3 X105. Y10. I0. J5.
G1 Y100.
G3 X100. Y105. I-5. J0.
G1 X10.
G3 X5. Y100. I0. J-5.
G1 Y10.
G3 X10. Y5. I5. J0.
G0 Z50.
M05
M11
M30
%
```

## 12. Post için ayar önerisi
| Alan | Değer | Not |
|---|---|---|
| program.prefix / suffix | `%` / `%` | [3] |
| program.start | `O0001 (AD)`, `G21`, `G90 G94 G17 G40 G49 G80`, `G54` | |
| program.end | `M05`, `M30` | |
| comments.style | `paren` (Fusion) ya da `/* */` (kılavuz) | doğrula |
| comments.asciiOnly / maxLength | true / 80 | [3] |
| lineNumbers.enabled | false | |
| modal.words | `G21 G90 G94 G17 G40 G49 G80 G54` | G91.1 yok |
| toolChange.mode | `auto` (ATC) / `manual` + `M00` | |
| toolChange.lengthOffset | `G43 Z.. H..` | [1] |
| spindle | `S18000 M03` / `M05`, rpmDecimals 0 | |
| dwell | `P`, `ms`, 0 ondalık | [1][3] |
| motion.machineCoordinates | G53 izinli, sonra G43 yeniden | [1] |
| decimals xy/z/arc | 3, her zaman nokta | |
| decimals.feed | 0 | |
| arcs.mode / distanceModeWord | `ijIncremental` / null | [1] |
| arcs.maxSweepDeg / helical | 180 / true | [3] |
| drill.cycles | `none` | |
| vacuum on/off | makine profili; MW varsayılan M10/M11 | [2] |
| file.extension | `.nc` | [3] |
| file.maxNameLength / lineEnding / maxSizeBytes | bilinmiyor / `crlf` varsayım / bilinmiyor | |

## 13. Makinede doğrulanması gerekenler
- `( )` yorumları düz ISO dosyada çalışıyor mu? Türkçe karakter?
- Noktasız `X10` 10 mm mi, 0.01 mm mi?
- `%` ve `O` satırı zorunlu mu? Dosya adı ve uzantı kuralları, satır sonu, boyut sınırı, DNC.
- MW makinesinin gerçek M-kod parametreleri (9400-9457).
- ATC'siz makinede M06 ne yapıyor?

## Kaynaklar
1. LNC Technology, LNC-MILL Series Programming Manual, V04.00.004, 2010/11. https://abmarketotomasyon.com/wp-content/uploads/2025/08/LNC-MILL_Programming_Manual_V04.00.0044408210031_ENG.pdf (erişim 2026-11-23) [maker manual]
2. LNC Technology, MW Woodworking Machine System Operation Manual, V1.1 (MW2200 ve diğerleri). https://www.cncwiki.org/images/d/da/LNC_MW_Woodworking_Machine_System_Operation_Manual_V1.1.pdf (erişim 2026-11-23) [maker manual]
3. Autodesk, Fusion post library, `lnc.cps` ("Generic post for LNC", revizyon tarihi 2026-09-02). https://cam.autodesk.com/posts/posts/lnc.cps (erişim 2026-11-23) [CAM vendor]
4. ManualsLib, LNC MW2200 Series Operation Manual. https://www.manualslib.com/manual/2874667/Lnc-Mw2200-Series.html (erişim 2026-11-23) [maker manual kopyası; arama özeti, belge açılamadı; [2] ile aynı belge olduğu bildiriliyor]
5. CNC Wiki, LNC MW2200A CNC Controller sayfası (Advantech LNC Milling Machine Series Programming Manual V01.02.000'a bağlantı). https://www.cncwiki.org/index.php?title=LNC_MW2200A_CNC_Controller (erişim 2026-11-23) [arama özeti, belge açılamadı]
