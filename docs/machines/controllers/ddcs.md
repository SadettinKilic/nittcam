# DDCS V3.1 / V4.1 / Expert (Digital Dream)
> Durum: araştırma notu, makinede doğrulanmadı. Güven: orta. V3.1 ve Expert kılavuzlarının G/M tabloları okundu. V4.1 kılavuzunun metin çıkarımında rakamlar bozuk çıktı (ör. 0 yerine ".", 8 yerine "6"), V4.1 değerleri bu yüzden çözümlenerek okundu ve aşağıda işaretlendi. Kılavuzların G/M tablolarında kendi içinde tutarsızlıklar var.

## Özet (post yazacak kişi için)
- Dwell `G4 P<milisaniye>`: `G4 P10000` = 10 sn, `G4 P2000` = 2 sn. Mach3 postunun `G4 P5.0` çıktısı DDCS'te 5 ms bekler, yani spindle hızlanmadan kesime girer [1][2][3].
- Ondalık ayırıcı nokta olmalıdır. Kılavuz virgülün çalışmadığını açıkça yazıyor [1][3].
- Ark: G90/G91 tablosuna göre ark merkezi varsayılan olarak artımsaldır. V3.1 ve Expert `G90.1` (mutlak merkez) ve `G91.1` kodlarını listeler, ama G91.1 satırının açıklaması kendi içinde çelişkili. Post `G90.1`/`G91.1` yazmamalı, varsayılan artımsal I/J kullanmalı [1][3].
- `M6 T..` V3.1/Expert'te `T.nc` makro dosyasını çalıştırır [1][3]. V4.1'de bir parametre (#705 olarak çözümlendi) açıksa M6'da makine referans noktası 1'e gider ve manuel değişim için durur [2]. Davranış makine üreticisinin makro ve parametre ayarına bağlıdır. En güvenlisi manuel `M0` ya da takım başına ayrı dosya.
- V3.1'de `G53` kılavuzda "arızalı" olarak geçiyor. Yerine `G153` (F hızıyla makine koordinatına hareket) öneriliyor [1]. Post `G53` yazmamalı.
- Delik döngüleri (G81/G82/G83/G73) var, ama Z, R düzlemine göre derinlik olarak ve K tekrar sayısıyla tanımlı, standarttan farklı [1][3]. `drill.cycles = "none"` önerilir.
- Soğutma ve yardımcı çıkışlar: `M8`/`M9` ve `M10`/`M11` [1][3]. Expert'te ayrıca `M50`-`M91` çiftleri OUT1-OUT21 çıkışlarını açıp kapatır [3]. Vakum hangi çıkışta, makine üreticisine bağlı.
- Dosya USB bellekten okunur. V3.1 kılavuzu G-code dosyası için boyut sınırı olmadığını söyler [1]. Editör yeni dosyayı `.nc` olarak açar, örneklerde `.tap` de var [1].

## Sürümler / donanım
- DDCS V3.1: 3-4 eksen bağımsız (standalone) kontrolör. 5" ekran, ARM9 + FPGA, eksen başına en fazla 500 kHz darbe, 0-10 V analog spindle (PWM'e çevrilebilir), USB bellek girişi [1]. Kılavuzda G93 için 2019-05-27-111, M101/M102 için 2018-10-12-102 ve M105-M108 için 2019-04-28-108 gibi firmware sürümü notları var [1].
- DDCS V4.1: V3.1'in devamı, analog veya servo (PUL+DIR) spindle, rigid tapping, ATC ile ilgili parametreler [2].
- DDCS Expert (M350 ailesi): daha büyük ekran, takım magazini parametreleri (#800 ve sonrası), 21'e kadar genel amaçlı çıkış [3].
- Atölye yaygınlığı: Çin üretimi giriş seviyesi router'larda ve retrofitlerde görülür (kaynak yok, bilinmiyor).

## 1. Program dosyası
- Uzantı: V3.1 editörü "INS NEW" ile yeni `.nc` dosyası oluşturur. Kılavuz örnekleri `2mmnew.tap` dosyasını kopyalar ve yükler [1]. Sistem dosyaları (`slib-g.nc`, `slib-m.nc`, `pause.nc`, `error.nc`, `extkey1.nc`) `.nc` uzantılıdır [2][3]. Öneri: `.nc`. Kabul edilen uzantıların tam listesi: bilinmiyor.
- Kodlama ve satır sonu: kılavuzlarda yazmıyor (bilinmiyor). CRLF ve yalnız ASCII güvenli varsayım.
- Boyut: V3.1 USB bellekten "boyut sınırı olmadan" G-code okur [1].
- USB: firmware yükseltmesi için USB belleğin FAT32 biçimlenmesi isteniyor [1][2]. Sistem USB belleği `udisk-sda1` olarak görür [1]. G-code dosyaları için ayrı bir FAT32 şartı yazılmamış ama aynı bellek kullanıldığı için FAT32 güvenli seçim.
- Dosya adı kuralları (uzunluk, Türkçe karakter): kılavuzlarda bulunamadı (bilinmiyor). Kısa ASCII ad önerilir.
- N numaraları: V4.1 "belirtilen satırdan başlat" özelliği satır sırasına göre çalışır [2]. N kelimesinin işlenişi: bilinmiyor. Yazmamak güvenli.
- Başlangıç/bitiş: `%` ve O-numarası için bilgi yok (bilinmiyor). Program sonu `M30` [1][3]. Expert'te O-numarası yalnız alt program etiketidir (`O00111`, `M98 P111`) [3].

## 2. Başlangıç modal durumu ve güvenli giriş
- Desteklenen modal kodlar (V3.1/Expert tablosu): G17/G18/G19, G20/G21, G90/G91, G90.1/G91.1, G93/G94, G54-G59, G98/G99 [1][3].
- G40/G41/G42/G43/G44/G49 V3.1 tablosunda "fonksiyon henüz çalışmıyor" notuyla geçiyor [1]. Post bu kodları yazmamalı.
- G1'de F yoksa #76 parametresindeki hız, G0'da #80 parametresindeki hız kullanılır [1]. Post her ilk G1'de F yazmalı.
- Önerilen giriş: `G21 G90 G17 G54` (G40/G49/G91.1 yazma).

## 3. Hareket
- G0/G1: standart. G0 hızı #80 parametresinden gelir [1].
- G2/G3: iki biçim var [1][3]:
  - mode1: `X Y (Z) I J (K)` merkez biçimi. Z helis (spiral dalma) için kullanılabilir.
  - mode2: `X Y (Z) R` yarıçap biçimi.
- Ark merkezi modu: G90 tablosuna göre "ana koordinatlar mutlak, ark merkezleri göreli" (yani I/J artımsal) [1][3]. G90.1 satırı ark merkezlerini mutlak yapar [1][3]. G91.1 satırı "merkezler mutlak" diyor ve G90.1 örneğini tekrarlıyor, bu açık bir tablo hatası gibi görünüyor [1][3]. G2 açıklamasındaki "bitiş noktasına göre" ifadesi de belirsiz. Makinede doğrulanmalı.
- Helis: Z ile G2/G3 desteklenir [1].
- Diğer: G12/G13 (yerinde daire), G102/G103 (elips), G110-G112 (cep makroları) V3.1'e özel uzantılar [1]. Post bunları kullanmamalı.
- Ark tolerans hatası ve en küçük segment: bilinmiyor. V4.1'de #124 interpolasyon periyodu kısa segmentlerin pürüzsüzlüğünü etkiler [2].

## 4. Besleme ve spindle
- F: mm/dk (G94), G93 ters zaman modu da var [1].
- Spindle: `M3 S..` başlatır, `M5` durdurur. S aynı satırda ya da ayrı satırda yazılabilir [1]. `M4` V3.1 tablosunda yok, Expert'te var [1][3].
- Spindle hızlanma: analog spindle'da tam hıza çıkma süresi parametreyle (#433 x 0.0005 s) tanımlı [1]. Bu kontrolörün gerçekten bekleyip beklemediği bilinmiyor. Post `G4 P<ms>` ile beklemeli.
- Dwell: `G4 P<milisaniye>`. Tablo örneği `G4 P10000` = 10 saniye. P kelimesinin açıklaması "G4 ve G82 için milisaniye" diyor [1][3]. V4.1: "G4 P1000, 1000 milisaniye bekle" (rakamlar çözümlenerek okundu) [2]. P ayrı bir satırda da yazılabilir [1].

## 5. Takım değişimi
- V3.1 ve Expert: `M6 T5` "T.nc dosyasının içeriğini çalıştırır". T, ofset için takım numarasını belirtir ve yazılmayabilir [1][3]. Yani M6 bir makro dosyasıdır ve davranışı (Z kaldırma, durma, ölçme) makine üreticisinin yazdığı içeriğe bağlıdır.
- V4.1: sistem klasöründe `slib-g.nc` ("sistem kütüphane dosyası") ve `slib-m.nc` ("kullanıcının tanımladığı M-kodu kütüphane dosyası") var [2]. M6 açıklaması "komut gelince başlar ve Cycle Start'a basılmasını bekler" [2]. #705 parametresi açıksa M6'da makine referans noktası 1'e döner ve durur, manuel takım değişimi için kullanılır [2] (parametre numarası çözümlenerek okundu).
- Expert: takım magazini parametreleri (#800 mevcut takım, #801 takım sayısı, #802 magazin tipi, #805 değişimden sonra otomatik ölçüm, #806-#809 değişim konumları vb.) ve manuel değişim için X/Y/Z makine konumu parametreleri var [3].
- Manuel değişim seçenekleri:
  - `M0`: programı durdurur, START bekler. Ayarlıysa Z'yi kaldırır ve spindle'ı durdurur [1][3].
  - `M110` (V3.1): eksenleri hareket ettirmeden durdurur ve sesli uyarı verir, "manuel takım değişimi için kullanışlı" [1]. Örnek kullanım `G153 Z0` sonra `M110(T5 cutter 5mm)`. Parantez içindeki yorum ekranda gösterilir [1].
- Takım boyu: `G43 H..`/`G49` V3.1'de çalışmıyor [1]. V4.1 tool length (H) ölçümü ve `G43 H_` anlatıyor, iptal kodu çözümleme sonucu belirsiz [2]. Post `G43` yazmamalı.

## 6. Koordinatlar
- G54-G59: desteklenir [1][2][3].
- G53: V3.1 tablosunda "arızalı, G153 kullanın" notu var [1]. `G153 X0 Y0 Z0 F3000` makine sıfırına F hızıyla gider [1]. V4.1 tablosunda G53 makine koordinatında hareket olarak listeleniyor [2].
- G28: V3.1'de yalnız G91 ile çalışır. Önce verilen artımsal noktaya, sonra makine sıfırına gider. Verilmeyen eksenler hareket etmez [1]. V4.1'de G28/G30 için referans noktasına gitmek amacıyla önce homing gerekir, yoksa alarm verir [2] (çözümlenerek okundu).
- G92: koordinat ayarlama [1].
- Homing: M105-M108 (V3.1, eksen bazlı homing) [1]. Homing zorunluluğu parametreye bağlı.

## 7. Yardımcı çıkışlar
- `M8`/`M9`: soğutma aç/kapa. `M10`/`M11`: V3.1 tablosunda "soğutma pompası", donanım bölümünde "yağlama" olarak geçiyor [1]. Çıkış pinleri: M3, M8, M10 [1].
- Expert: `M50`/`M51` ... `M90`/`M91` çiftleri OUT1-OUT21 çıkışlarını açar/kapatır [3].
- Vakum: standart kod yok. Bağlantıya göre `M8` veya `M10` (makine üreticisine bağlı).
- M8/M9 ve M10/M11 için gecikme süresi ve aktif seviye parametreleri var [1].

## 8. Delik döngüleri ve alt programlar
- V3.1/Expert: G81, G82 (P ms dip beklemesi), G83, G73, G98/G99 [1][3]. Biçim standart değil: Z "R'den deliğin dibine olan mesafe", K "tekrar sayısı", G83'te I "geri çekme farkı" [1][3]. Örnekler `Q1,4` gibi virgüllü yazılmış, oysa kılavuz başka yerde virgülün çalışmadığını söylüyor [1][3]. Bu döngülere güvenilmemeli.
- V4.1: G73, G81, G82, G83, G84/G74 rigid tapping, G98/G99 [2] (çözümlenerek okundu).
- Alt program (Expert): `M98 Pxxxx Ln` O-numaralı alt programı çağırır, `M99` döner. Ana programda M99 programı başa sarar [3]. `M47` programı ilk satırdan tekrarlar [3].
- Makro değişkenleri: `#1=SIN[30.0]` gibi ifadeler [1][3].

## 9. Yorumlar ve karakterler
- `( )` parantez yorumu. Bir satırda yorum varsa ekranda yalnız parantez içi gösterilir [1].
- `;` desteği: bilinmiyor.
- ASCII / Türkçe: kılavuzlarda yazmıyor. Arayüz Çince, İngilizce ve Rusça (V3.1) [1]. Öneri: yalnız ASCII, kısa yorum.
- Ondalık ayırıcı nokta, virgül çalışmaz [1][3].

## 10. Bilinen tuzaklar
- `G4 P` milisaniyedir. Saniye yazan postlar spindle hızlanmadan kesime girer [1][2][3].
- V3.1'de `G53` arızalı olarak işaretli [1]. Park için `G153` ya da hiç kullanmamak.
- V3.1'de G40-G49 takım telafisi kodları çalışmıyor [1].
- Delik döngülerinde Z ve R anlamı standart değil [1][3].
- Kılavuz tablosunda "M6'dan hemen sonra kullanmayın" uyarısı var, ama tablo düzeni yüzünden hangi koda ait olduğu (M30, M110 ya da M47) net değil [1][3]. Post M6 ile M30'u art arda yazmamalı.
- V4.1 kılavuzunun PDF metni bozuk fontlu. Değerleri kılavuzun görsel sayfasından teyit etmek gerekiyor [2].

## 11. Minimal güvenli program
Türetilmiş, makinede denenmedi. 100x100 mm kare, bir köşe R10 yay, 3 mm derinlik.
```
(NITTCAM DDCS TEST - DOGRULANMADI)
G21 G90 G17 G54
G0 Z10.000
M8
M3 S18000
G4 P5000
G0 X0.000 Y0.000
G1 Z-3.000 F300
G1 X100.000 Y0.000 F1500
G1 X100.000 Y90.000
G3 X90.000 Y100.000 I-10.000 J0.000
G1 X0.000 Y100.000
G1 X0.000 Y0.000
G0 Z10.000
M5
M9
M30
```

## 12. Post için ayar önerisi
| Alan | Değer | Not |
|---|---|---|
| file.extension | `.nc` | `.tap` de kılavuz örneklerinde var [1] |
| file.lineEnding | `crlf` | belirsiz |
| file.maxSizeBytes / onOversize | null | V3.1 sınır yok diyor [1] |
| file.maxNameLength | 32 (öneri) | belirsiz |
| program.prefix / suffix | yok (`%` yazma) | belirsiz |
| program.end | `M30` | |
| comments.style | `paren` | [1] |
| comments.asciiOnly | true | |
| comments.maxLength | 40 (öneri) | ekran 480x272, belirsiz |
| lineNumbers.enabled | false | |
| modal.words | `G21 G90 G17 G54` | G40/G49/G91.1 yazma |
| toolChange.mode | `manual` veya `none` | M6 makroya bağlı |
| toolChange.manualStop | `M0` | V3.1'de `M110` alternatif [1] |
| toolChange.lengthOffset | yok | G43 V3.1'de çalışmıyor [1] |
| toolChange.pauseForFirstTool | true | |
| spindle.on / off / speedPosition | `M3` / `M5` / `after` | |
| spindle.rpmDecimals | 0 | |
| dwell.word / unit / decimals | `P` / `ms` / 0 | [1][2][3] |
| motion.machineCoordinates | false | V3.1 G53 arızalı [1] |
| decimals.xy / z / arc / feed | 3 / 3 / 3 / 0 | |
| arcs.mode / distanceModeWord | `ijIncremental` / null | [1][3] |
| arcs.fullCircle | false | |
| arcs.helical | true | [1], doğrula |
| arcs.maxSweepDeg | 180 | |
| drill.cycles | `none` | standart dışı döngüler |
| vacuum on/off | `M8`/`M9` veya `M10`/`M11` | makine üreticisine bağlı |

## 13. Makinede doğrulanması gerekenler
- `G4 P5000` gerçekten 5 saniye mi?
- `G3 ... I-10 J0` artımsal merkezle doğru çiziliyor mu? (G90.1/G91.1 yazmadan.)
- `M6` ve `T.nc`/`slib-m.nc` içeriği bu makinede ne yapıyor? `M0` Z'yi kaldırıyor mu?
- Vakum hangi M kodunda (M8 mi, M10 mu)?
- Dosya adında Türkçe karakter ve uzun ad sorun çıkarıyor mu? `.tap` uzantısı listeleniyor mu?
- Firmware sürümü (kılavuzdaki sürüm notlarıyla karşılaştırmak için).
- G53 bu firmware'de çalışıyor mu?

## Kaynaklar
1. DDCS V3.1 Users Manual (Digital Dream), G Code and M Code bölümü s. 75-80, parametreler s. 60-68, dosya işlemleri s. 29-31. Üçüncü taraf ayna: https://cnc-tehnologi.ru/files/DDCS_V3.1_MANUAL_V3.pdf (erişim 2026-11-23) [maker manual, ayna kopya]
2. DDCS V4.1 User's Manual in English V1 (Digital Dream), sistem dosyaları s. 73, G/M kodları s. 87-89, parametre #705. https://cdn.shopify.com/s/files/1/0596/8370/0902/files/DDCS_V41_User_s_manual_in_English_V1.pdf (erişim 2026-11-23) [maker manual; Shopify CDN kopyası, ddcnc.com bağlantısı doğrulanmadı; metin çıkarımında rakamlar bozuk]
3. DDCS Expert User's Manual V1 (Digital Dream), G/M kodları s. ~130-136, takım magazini parametreleri #800 ve sonrası. https://cdn.shopify.com/s/files/1/0596/8370/0902/files/DDCS_Expert_User_s_Manual_V1.pdf (erişim 2026-11-23) [maker manual; Shopify CDN kopyası]
