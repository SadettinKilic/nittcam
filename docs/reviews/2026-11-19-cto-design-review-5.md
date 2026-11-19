# CTO tasarım incelemesi #5 (2026-11-19)

Kapsam: main `6c5722f` (B11 ve B11a sonrası). Önceki inceleme: `2026-11-19-cto-design-review-4.md`.

Yöntem: uygulama üretim derlemesiyle ve boş bir PGlite veritabanıyla 3210 portunda çalıştırıldı (inceleme #4 ile aynı kurulum). Playwright ile tek tarayıcıda 1440 × 900 (açık ve koyu) ve 1024 × 768'de değişen ekranlar gezildi: çizim tahtası (özellikler paneli, köşe araçları), 1. adım, makine formu "Malzeme parametreleri", "Dolap ekle", kesim listesi (Uyarılar paneli), Ayarlar → Malzemeler. 390 × 844 yalnızca "kırılıyor mu" diye ölçüldü. 15 görüntü `2026-11-19-cto-5/` klasöründe. Ürün koduna dokunulmadı; e2e paketi çalıştırılmadı.

Uygulanan kurallar: **D-047** (bulgular "şimdi düzelt" ve "cila kuyruğu" diye ayrılır; en çok 3 görev), D-043 (önce masaüstü), D-045 (operatör gezintisi her incelemede).

Sınırlar: gezintileri bir insan değil betik yaptı; tık ve değer sayıları gerçek, süre tahmindir. Fare tekerleğiyle yakınlaştırma tık sayılmadı. Gezintilerde konsol hatası veya sayfa hatası görülmedi. İnen iki G-code dosyası elle okundu (aşağıda).

## Puanlar

| Başlık | #3 | #4 | #5 | Not |
| --- | --- | --- | --- | --- |
| Kurumsal imaj / marka | 7 | 7,5 | 7,5 | İngilizce satır ve iç kodlar gitti, Malzemeler çipi okunuyor, kopyalanan ayarın notu dürüst. Puanı tutan: özellikler paneli yana taşıyor ve yarıçap alanı ekran dışına kesiliyor, bildirim köşe araçlarını örtüyor, L parçanın etiketi parçanın dışında |
| Modernlik | 8 | 8 | 8 | Tuvalde ölçü çipi ("En 200 ; Boy 150"), "Kapat" yakalaması, tek tıkla dogbone güncel CAD hissi veriyor. Yeni bir sıçrama yok, gerileme de yok |
| Kullanılabilirlik | 7,5 | 7,5 | 8 | Dolap işi 17 tık / 5 değer, hazır dört malzemenin üçü İndir'e kadar gidiyor, eksik ayar 1. adımda yakalanıyor. 8,5'i tutan: "Kesim ayarı ekle" dönüşü yanlış projeye düşebiliyor, tahtada küçük parça %18'de çiziliyor, dikdörtgenden L yapılamıyor |
| M4–M6 için hazır olma | 7,5 | 8 | 8 | Özellikler paneli (Parça / Damar / İşlem / Kenar / Köşe) delik ve cep için doğru kalıp. Risk aynı: 1024'te tuval 430 × 457 ve panel 460 px yüksekliğe 791 px içerik sığdırıyor (T263 B13'te) |

Sahibin "kullanım kolaylığı ana hedef" isteği artık varsayılan yolda da karşılanıyor: yeni kurulumda hiçbir seçim yapmadan İndir'e varılıyor. Çizim tahtası ilk kez uçtan uca iş çıkardı (elle çizilen L konsol → kontrolü geçen G-code).

## Gezinti 1: mutfak alt dolabı (D-045, tekrar)

İş: 600 × 720 × 560 alt dolap + 2 raf (dolap üreticisi), elle bir ek parça (Baza 564 × 100), diz, simüle et, G-code indir. Malzeme: varsayılan (MDF 18 mm).

| Ölçü | #4 | #5 |
| --- | --- | --- |
| Tık | 19 | **17** |
| Yazılan değer | 5 | **5** |
| Ekran | 5 adım + 1 pencere | 5 adım + 1 pencere |
| Betik süresi | 12,9 sn | 20,1 sn (bekleme ve görüntü dahil; karşılaştırılamaz) |
| Çıktı | `Mutfak_alt_dolap_60_S1.tap`, 14,0 KB | `Mutfak_alt_dolap_60_S1.tap`, 12,2 KB, bütün kontroller geçti, 1 plaka |

Tıkların dağılımı: Yeni proje 1 · proje adı 1 · İleri 4 · Dolap ekle 3 (aç, raf alanı, "7 parça ekle") · Satır ekle 1 · Diz 1 · Oynat 1 · güvenlik onayı 4 · İndir 1. Kazanılan iki tık malzeme seçimi: proje artık kütüphanedeki "MDF · 18 mm" ile açılıyor (`wizard-step1-default-1440-light.png`). Testçinin B11a ölçümüyle aynı (17 / 5).

Duraksama noktaları:

1. **Arkalık artık listeye girmiyor, bunu açıkça söylüyor** (`cabinet-dialog-1440-light.png`): "1 × Arkalık 564 × 720 · 8 mm · ayrı plaka" ve altında "Bu parça 18 mm plakadan kesilmez; listeye kendiliğinden eklenmez. ☐ Yine de listeye ekle". İnceleme #4'ün üretim hatası kapandı; düğme "7 parça ekle" diyor. MDF'de satırlar "Serbest" geliyor.
2. **Dizilim hâlâ boş açılıyor**, "Diz" bir tık. T261 B12'de; yeni görev yok. Gelince gezinti 16 tıka iner.
3. **Simülasyondaki G-code başlığı hâlâ "NittCam_S1.tap / (PROJE: NittCam) / (REVIZYON: 0)"**; inen dosya `(PROJE: Mutfak alt dolap 60) (REVIZYON: 3)`. T262 B13'te; yeni görev yok.
4. 1. adımda kalınlık alanının altında "Kütüphanedeki kalınlıklar: 18 mm [18]" satırı tek kalınlık varken bilgi vermiyor (cila).

Sonuç: iyi yol kısaldı ve D-045'in "hazır gelen her şey birlikte çalışır" kuralı tutuyor.

## Gezinti 2: çizim tahtasında L raf konsolu (yeni)

İş: 200 × 150 mm, kol kalınlığı 40 mm L konsol; dış köşe R15 yuvarlak, iç köşeye dogbone; diz, İndir.

### İstenen yol çıkmaz: dikdörtgen → serbest şekil → düzenle

Dikdörtgen aracı + "200;150" iki değerle parça çiziyor (`board-line-draw-1440-light.png` aynı ölçeği gösterir), "Serbest şekle dönüştür" tek tık. Ama serbest şeklin 4 köşesi var ve panelde **köşe eklemek ya da kenarı bölmek yok**: uzunluk ve köşe X/Y düzenlenebiliyor, L için gereken iki yeni köşe üretilemiyor. 9 tık ve 3 değerden sonra parça silinip çizgi aracıyla baştan çizilmek zorunda. Marangozun düşünme biçimi ("dikdörtgenden bir köşe çıkar") üründe karşılıksız. Çıkış yolu olduğu için (çizgi aracı) cila kuyruğuna yazıldı; B13 (T137) için en değerli aday.

### Çalışan yol: çizgi aracı

| Ölçü | Değer |
| --- | --- |
| Tık | **23** (Yeni proje 1 · proje adı 1 · İleri 4 · Çizim 1 · Çizgi aracı 1 · başlangıç 1 · başlangıca tıklayıp kapat 1 · Tümünü göster 1 · Seç aracı 1 · dış köşe 1 · yarıçap alanı 1 · Köşeyi yuvarla 1 · iç köşe 1 · Taşma aç 1 · Diz 1 · onay 4 · İndir 1) |
| Yazılan değer | **12** (proje adı, 5 kenar × uzunluk + açı, yarıçap 15) |
| Ekran | 5 adım; tekerlekle 5 çentik yakınlaştırma (sayılmadı) |
| Betik süresi | 20,3 sn; tahmini operatör süresi bilen biri için 3–4 dk, ilk kez 8–10 dk (tahmin) |
| Çıktı | `Raf_konsolu_S1.tap`, kontroller geçti, 83 hareket, ≈ 38 sn |

Çıktı elle doğrulandı: dış köşe G2 ile R19 (15 + takım yarıçapı 4), iç köşede takım merkezi köşeye tam 4,00 mm yaklaşıyor (X117,17 Y52,83; köşe X120 Y50), yani 8 mm takım köşe noktasını kesiyor. Dogbone ve yuvarlama G-code'a doğru iniyor.

Duraksama noktaları (akış sırasıyla):

1. **Parça %18 ölçekte çiziliyor** (`board-line-draw-1440-light.png`). Tahta 2.800 × 2.070 plakayı gösterecek şekilde açılıyor; 200 mm'lik konsol ekranda 35 px. "Tümünü göster" plakayı da kadraja aldığı için değişmiyor; "seçime yakınlaş" yok. Operatör tekerlekle kendisi yaklaşmalı.
2. **Uzunluk + açı girişi iyi, açı yükü ağır.** Çip "Uzunluk 150,0 ; Açı 270,0°" canlı gösteriyor, Tab alan değiştiriyor, başlangıca gelince "Kapat" yakalıyor: sayı aramak gerekmedi. Ama dik açılı bir parçada beş kez açı (0 / 90 / 180) yazmak 12 değerin beşi; yön ok tuşundan ya da fare yönünden gelebilir (45° / 90° kilidi yalnızca fareyle çalışıyor).
3. **Uyarı doğru yerde, doğru anda** (`board-properties-1440-light.png` ile aynı panel): şekil kapanır kapanmaz "Takım iç köşeye giremez: 1 iç köşe takım yarıçapından (4 mm) dar… [Otomatik düzelt]". D-045'in "sorunu doğduğu yerde yakala" kuralının tahtadaki karşılığı; dogbone açılınca kendiliğinden kayboluyor.
4. **Köşe araçları ekranın altında ve yana taşıyor** (`board-dogbone-toast-1440-light.png`, `board-properties-1024-light.png`). "Köşe" grubu panelin en altında: 1440 × 900'de yarıçap alanı y = 867, alt çubuk y = 848'de başlıyor; her seferinde panel kaydırılıyor. Panel içeriği 294 px, panel 264 px: "Yuvarlama yarıçapı" satırı 30 px taşıyor, alan 1440'ta x = 1446'da, 1024'te x = 1030'da bitiyor (birim ekran dışında), panel yana kayınca soldaki etiketler kesiliyor. → T266
5. **Köşe numaraları değişiyor.** Dış köşe yuvarlanınca iç köşe "Köşe 4" iken "Köşe 5" oldu. Tuvalden tıklayarak seçmek sorunsuz (gezinti öyle yapıldı); listeden seçen operatör yanlış köşeye işlem yapabilir. Seçili köşe tuvalde dolu kare ile görünüyor ama numara yazmıyor.
6. **Bildirim işlem yapılan alanı örtüyor** (`board-dogbone-toast-1440-light.png`): "İç köşeye 4 mm yarıçaplı taşma açıldı." bildirimi alt çubuğun üstünde ama özellikler panelinin son satırlarının (X / Y / yarıçap) üzerinde.
7. **Köşe X / Y tahta koordinatı** (`board-properties-1440-light.png`): ilk tık yuvarlak bir noktaya oturmadığı için köşeler "604,56 / 402,34". Köşeyi 10 mm kaydırmak için kafadan toplama gerekiyor; parçaya göre (0–200 / 0–150) koordinat bekleniyor.
8. **Kenar uzunluğu dik parçada komşuyu eğiyor.** Alt kenar 185 → 205 yapılınca kolun uç kenarı "44,72 mm · 116,57°" oldu (spec §4.4'teki kural: uç köşe kayar, komşu izler). Kural tutarlı ama konsolun ucu yamuk çıkıyor; operatör "kolu 20 mm uzat" demek istiyordu. Tek geri alma düzeltiyor.
9. **Dizilim ve Simülasyon'da küçük parça kaybolmuş gibi**: konsol plakanın sol alt köşesinde 30 px; tuval parçaya değil plakaya kadrajlı. İş görüyor, güven vermiyor.

Özet: tahta ilk kez gerçek bir işi bitirdi ve çıktısı doğru. Sürtünmenin kaynağı araçlar değil **ölçek ve görünürlük**: parça küçük çiziliyor, köşe araçları katlanmış panelin altında.

## 1. adım ve "Kesim ayarı ekle" (B11a)

İyi olan: ayarı olmayan malzeme seçilince kırmızı kutu ve tek düğme aynı ekranda (`wizard-step1-no-params-1440-light.png`), adım göstergesinde kırmızı nokta, "Bu makinede kesim ayarı olan kalınlıklar: 5 mm [5]" kısayolu. Makine formunda kopyalanan Melamin / Kontrplak satırlarının altında "MDF 18 mm ayarından kopyalandı; kendi makinenizde doğrulayın." notu duruyor (`machine-params-1440-light.png`). Kaydedince "Projeye dön" kutusu çıkıyor.

İki sorun bulundu:

1. **Dönüş yanlış projeye düşebiliyor** (`param-fix-wrong-project-1440-light.png`). Yeni projede ilk işlem malzeme seçmekse ve "Kesim ayarı ekle"ye ilk otomatik kayıt bitmeden (ölçülen: 0,3–0,8 sn içinde) basılırsa bağlantı `donus=/projeler/yeni` taşıyor. Sonuç: makine formu açıkken adres çubuğu proje adresini gösteriyor; "Projeye dön" **yeni, boş bir MDF projesi** ("Adsız proje 2", "Sorun yok") açıyor; Akrilik seçili asıl proje listede yetim kalıyor. 4 sn bekleyince dönüş doğru. Kullanıcı sorunu çözdüğünü sanıp yanlış projede devam eder. → T264
2. **Eklenen satır körlemesine kaydedilebiliyor** (`machine-params-1440-light.png`). "Kesim ayarı ekle" Akrilik 5 mm için satırı 5.000 mm/dk · 18.000 dev/dk · **6 mm paso** (5 mm plakada) · ilk takım ile dolduruyor; "Kaydet" hemen açık, satırın altında hiçbir not yok. Kaydedince Malzemeler'de yeşil "Tamam" çipi çıkıyor (`materials-1440-light.png`). D-046 akriliği bilerek ayarsız bıraktı ("plastik için ayrı değer gerekir"); bu akış aynı değeri tek tıkla, kopyalanan ahşap ayarlarındaki uyarı bile olmadan içeri alıyor. PVC ve masif ahşap için de aynı. → T265

Ayrıca (cila): tablo 1.095 px, görünen alan 1440'ta 828, 1024'te 476 px; "Paso", "Takım no" ve "Sil" sütunları yatay kaydırmanın arkasında (`machine-params-1024-light.png`). Düzeltme akışında sayfa "Takımlar" bölümünde vurgulanıyor, başlık "Projeler › Proje" diyor.

## İyi olanlar (koruyun)

- **Özellikler paneli kalıbı** (`board-properties-1440-light.png`, `board-properties-1440-dark.png`): Ölçü / Konum özeti, simge işlemler, katlanır gruplar. Koyu temada da okunuyor. Delik ve cep (M5) aynı kalıba oturur.
- **Tuvalde ölçü çipi ve "Kapat" yakalaması** (`board-line-draw-1440-light.png`): klavyeyle çizim akıyor.
- **İç köşe uyarısı + Otomatik düzelt + tek tıkla dogbone**: makine bilgisi (takım yarıçapı 4 mm) çizim anında kullanıcıya dönüyor.
- **Dolap penceresi** (`cabinet-dialog-1440-light.png`, `cabinet-dialog-1440-dark.png`, `cabinet-dialog-1024-light.png`): etiketler tek satır, arkalık dürüst, 1024'te sığıyor.
- **Uyarılar paneli çipten açılıyor** (`cutlist-issues-1440-light.png`): 1440 ve 1024'te kapalı duruyor, hiçbir hücreyi örtmüyor; çipe tıklayınca açılıyor ve satırı adıyla söylüyor ("Satır 7 · Tezgah: Parça plakaya sığmıyor").
- **Bildirimler alt çubuğun üstünde**: "İleri" hiçbir gezintide örtülmedi.
- **Malzemeler çipi** (`materials-1440-light.png`): "Örnek router (Mach3) · Tamam" kesilmeden okunuyor.

## Şimdi düzelt (D-047: en çok 3 görev, her biri en çok yarım gün) → parti B12a

| Görev | Konu | Neden "şimdi" |
| --- | --- | --- |
| T264 | "Kesim ayarı ekle" her zaman aynı projeye döner | Akış yanlış yere çıkıyor: kullanıcı farkına varmadan başka (boş) projede devam ediyor, asıl proje yetim kalıyor (çıkmaz akış / iş kaybı) |
| T265 | Düzeltme akışında eklenen kesim ayarı körlemesine kaydedilmez | Makine güvenliği: plastik için doğrulanmamış besleme / devir ve plakadan derin paso tek tıkla, uyarısız kaydediliyor, "Tamam" görünüyor |
| T266 | Köşe araçları panelde taşmaz ve erişilir | Partinin ana özelliği iki masaüstü genişliğinde de ekran dışına kesiliyor ve katlanmış panelin altında (çekirdek akışta kullanım engeli; yalnızca yerleşim) |

Zaten yazılı olup bu incelemede teyit edilenler (yeni görev yok): T261 (Dizilim kendisi dizer, B12), T262 (simülasyon başlığı, B13), T263 (1024 tuval bütçesi ve Malzemeler 37 px taşma, B13).

## Cila kuyruğu (D-047)

16 satır `docs/BACKLOG.md` "Polish queue (M9; D-047)" bölümüne eklendi (görev numarası yok). En değerli üçü: kenarı böl / köşe ekle, seçime yakınlaş, parçaya göre köşe koordinatı.

Telefon (390 × 844) duman testi: ana sayfa, 1. adım, tahta, kesim listesi, dolap penceresi, Malzemeler ve makine formunda sayfa düzeyinde yatay kayma yok; "İleri" her adımda erişilebilir. Yeni telefon notu "Mobile UI pass" bölümüne eklendi.

## Karar verildi (sahibi isterse değiştirir)

Yeni kural yok; D-049 açılmadı. Aşağıdakiler var olan kuralların uygulamasıdır:

- **K1 (D-046'nın devamı):** düzeltme akışının doldurduğu satır "başlangıç değeri" olarak işaretlenir ve notu kopyalanan satırlardaki gibi görünür; paso plaka kalınlığını geçemez. Değerlerin kendisi değişmez, golden dosyalara dokunulmaz.
- **K2:** dikdörtgenden L (kenarı böl / köşe ekle) cila kuyruğunda kalır; PO isterse B13'te T137 ile alır. İnceleme bunu "şimdi" yapmadı çünkü çizgi aracıyla iş bitiyor ve yarım günü aşar.
- **K3:** kenar uzunluğu kuralı (uç köşe kayar, komşu izler; spec §4.4) değişmedi; dik parçalardaki eğilme cila kuyruğuna not edildi, kural değişikliği sahibinin kararıdır.
- **K4 (D-045 ölçüsü):** gezinti tabanı güncellendi: dolap işi **17 tık / 5 değer**; çizim tahtası işi (L konsol) **23 tık / 12 değer**. İkisi de her incelemede tekrarlanır.

## Çıktılar

- `docs/BACKLOG.md`: yeni **B12a** = T264–T266 (B12'den sonra, B13'ten önce); "Polish queue (M9; D-047)" bölümüne 16 satır; "Mobile UI pass" bölümüne 1 not. Özet: 124 → 127 görev, 36 → 37 parti.
- `docs/DECISIONS.md`: değişmedi.

## Görüntüler

Klasör: `docs/reviews/2026-11-19-cto-5/` (15 dosya; 1440 × 900 ve 1024 × 768).

| Ekran | Dosyalar |
| --- | --- |
| Çizim tahtası | `board-properties-1440-light.png`, `board-properties-1440-dark.png`, `board-properties-1024-light.png`, `board-dogbone-toast-1440-light.png`, `board-line-draw-1440-light.png` |
| 1. adım | `wizard-step1-default-1440-light.png`, `wizard-step1-no-params-1440-light.png`, `param-fix-wrong-project-1440-light.png` |
| Makine formu | `machine-params-1440-light.png`, `machine-params-1024-light.png` |
| Dolap ekle | `cabinet-dialog-1440-light.png`, `cabinet-dialog-1440-dark.png`, `cabinet-dialog-1024-light.png` |
| Kesim listesi | `cutlist-issues-1440-light.png` |
| Ayarlar → Malzemeler | `materials-1440-light.png` (inceleme sırasında Akrilik 5 mm ayarı kaydedildiği için "Tamam" görünüyor; boş kurulumda "Ayar yok") |
