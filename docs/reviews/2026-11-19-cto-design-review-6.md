# CTO tasarım incelemesi #6 (2026-11-19)

Kapsam: main `27c04d2` (B12 #65, B12a #72 ve B13r #71 sonrası). Önceki inceleme: `2026-11-19-cto-design-review-5.md`.

Yöntem: uygulama üretim derlemesiyle ve boş bir PGlite veritabanıyla 3210 portunda çalıştırıldı (inceleme #5 ile aynı kurulum). İnceleme `209ef74` üzerinde başladı; B13r main'e girince dal güncellendi, yeniden derlendi ve bütün ölçümler boş veritabanıyla `27c04d2` üzerinde tekrarlandı. Playwright ile tek tarayıcıda 1440 × 900 (açık ve koyu), 1280 × 800 ve 1024 × 768'de değişen ekranlar gezildi: çizim tahtası (iç kesim, ölçü, köşe araçları), kesim listesi, Dizilim, Simülasyon, Dışa aktar, 1. adım, makine formu "Malzeme parametreleri", Ayarlar → Malzemeler. 390 × 844 yalnızca "kırılıyor mu" diye ölçüldü. 28 görüntü `2026-11-19-cto-6/` klasöründe. Ürün koduna dokunulmadı; e2e paketi çalıştırılmadı.

Uygulanan kurallar: **D-047** (bulgular "şimdi düzelt" ve "cila kuyruğu" diye ayrılır; en çok 3 görev), D-043 (önce masaüstü), D-045 (operatör gezintisi her incelemede).

Sınırlar: gezintileri bir insan değil betik yaptı; tık ve değer sayıları gerçek, süre tahmindir. Fare tekerleğiyle yakınlaştırma tık sayılmadı. Gezintilerde konsol hatası veya sayfa hatası görülmedi. İnen dört G-code dosyası elle okundu (aşağıda). Küçük iç kesim eşiği iki noktada denendi (Ø24 kilitliyor, Ø35 geçiyor); arası ölçülmedi. Zaten yazılı olan konular yeniden açılmadı: T267, T268, yeni projede doğrulanmamış ilk ayarın seçilmesi, Malzemeler tablosunun 1024'te kutu içinde kayması, Makine / Dışa aktar adımlarında iki satırlı başlık.

## Puanlar

| Başlık | #3 | #4 | #5 | #6 | Not |
| --- | --- | --- | --- | --- | --- |
| Kurumsal imaj / marka | 7 | 7,5 | 7,5 | 7,5 | Köşe araçları panele sığıyor, bildirim paneli örtmüyor, doğrulanmamış ayar her ekranda dürüstçe söyleniyor. Puanı tutan: "İç kesim olarak ekle?" penceresinde ana düğme pencereden 18 px taşıyor, iç kesim boşluk gibi görünmüyor (parça rengiyle dolu, etiket üstünde), küçük parçada ölçü etiketleri üst üste |
| Modernlik | 8 | 8 | 8 | 8 | Kalıcı ölçü çizgisi, çizilen şeklin iç kesime dönüşmesi, simülasyonda gerçek dosya başlığı ve dar ekranda simge menü güncel CAD/CAM hissini koruyor. Sıçrama yok, gerileme yok |
| Kullanılabilirlik | 7,5 | 7,5 | 8 | 8 | Dolap işi 16 tık / 5 değer, L konsol 22 tık / 12 değer; "Kesim ayarı ekle" her denemede aynı projeye döndü. 8,5'i tutan iki bulgu: simülasyon indirilen dosyadan farklı bir programı gösterebiliyor, takıma göre küçük yuvarlak iç kesim ilk kez 4. adımda ve parça adı verilmeden kilitliyor |
| M4–M6 için hazır olma | 7,5 | 8 | 8 | 8,5 | İnceleme #5'in riski kapandı: 1024'te tuval 590 × 485 (hedef 580 × 480). İç kontur uçtan uca çalışıyor ve G-code'da doğru (önce iç, sonra dış; göbekte köprü). 9'u tutan: iç kesim eklendikten sonra seçilemiyor, taşınamıyor, ölçüsü ve konumu yazılamıyor; delik ve cep (B14) aynı eksikle gelirse tahta "sil, yeniden çiz" aracı olur |

Özet: iki parti de söz verdiğini yaptı. Bu incelemenin iki "şimdi düzelt" bulgusu yeni özelliklerden değil, adımlar arasındaki tutarlılıktan geliyor: önizleme ile dosya aynı kaynaktan üretilmeli, kilitleyen sorun doğduğu adımda söylenmeli.

## Gezinti 1: mutfak alt dolabı (D-045, tekrar)

İş: 600 × 720 × 560 alt dolap + 2 raf (dolap üreticisi), elle bir ek parça (Baza 564 × 100), simüle et, G-code indir. Malzeme: varsayılan (MDF 18 mm).

| Ölçü | #4 | #5 | #6 |
| --- | --- | --- | --- |
| Tık | 19 | 17 | **16** |
| Yazılan değer | 5 | 5 | **5** |
| Ekran | 5 adım + 1 pencere | 5 adım + 1 pencere | 5 adım + 1 pencere |
| Betik süresi | 12,9 sn | 20,1 sn | 12,2 sn (bekleme ve görüntü dahil; karşılaştırılamaz) |
| Çıktı | 14,0 KB | 12,2 KB, kontroller geçti | `Mutfak_alt_dolap_60_S1.tap`, 12,5 KB, 510 satır, bütün kontroller geçti, 1 plaka |

Tıkların dağılımı: Yeni proje 1 · proje adı 1 · İleri 4 · Dolap ekle 3 (aç, raf alanı, "7 parça ekle") · Satır ekle 1 · Oynat 1 · güvenlik onayı 4 · İndir 1. Kazanılan tık "Diz": Dizilim adımı ilk girişte kendisi diziyor (T261).

Duraksama noktaları:

1. **Dizilim hazır geliyor** (`layout-cabinet-1024-light.png`): İleri'ye basınca yerleşim ekranda; geri alma tek adım. İnceleme #4'ün maddesi kapandı.
2. **Simülasyondaki G-code başlığı gerçek** (`sim-cabinet-1440-light.png`, `sim-cabinet-1440-dark.png`): panel "Dosya: Mutfak_alt_dolap_60_S1.tap / (PROJE: Mutfak alt dolap 60) / (REVIZYON: 3)" diyor; inen dosyada aynı üç satır var (T262). Ancak profil satırı ve yolun kendisi her zaman aynı değil: aşağıda "Önizleme ile dosya ayrışıyor".
3. Kesim listesi (`cutlist-cabinet-1440-light.png`): "Sorun yok", 6 satır · 8 parça. Bildirim "Dolap 1: 5 satır eklendi" derken düğme "7 parça ekle" diyordu (satır / parça); küçük bir söz farkı, cila.

Sonuç: iyi yol bir tık daha kısaldı; taban 16 / 5.

## Gezinti 2: çizim tahtasında L raf konsolu (D-045, tekrar)

İş: 200 × 150 mm, kol kalınlığı 40 mm L konsol; dış köşe R15 yuvarlak, iç köşeye dogbone; İndir. Çizgi aracıyla (inceleme #5'teki çalışan yol).

| Ölçü | #5 | #6 |
| --- | --- | --- |
| Tık | 23 | **22** (Yeni proje 1 · proje adı 1 · İleri 4 · Çizim 1 · Çizgi aracı 1 · başlangıç 1 · başlangıca tıklayıp kapat 1 · Seç aracı 1 · Tümünü göster 1 · dış köşe 1 · yarıçap alanı 1 · Köşeyi yuvarla 1 · iç köşe 1 · Taşma aç 1 · onay 4 · İndir 1) |
| Yazılan değer | 12 | **12** (proje adı, 5 kenar × uzunluk + açı, yarıçap 15) |
| Ekran | 5 adım; tekerlekle 5 çentik | 5 adım; tekerlekle 5 çentik (sayılmadı) |
| Çıktı | kontroller geçti, 83 hareket | `Raf_konsolu_S1.tap`, 2,6 KB, 104 satır, kontroller geçti |

Çıktı elle doğrulandı: dış köşe G2 ile R19 (15 + takım yarıçapı 4), iç köşede takım merkezi X117,17 Y52,83 (köşe X120 Y50, uzaklık 4,00 mm), 4 köprü. İnceleme #5 ile aynı geometri.

İnceleme #5'in maddeleri ne oldu:

1. **Köşe araçları erişilir** (T266; `board-corner-1440-light.png`, `board-dogbone-1440-light.png`): köşe seçilince "Köşe" grubu görünür alana geliyor; yarıçap alanı y = 761–793, alt çubuk y = 843; panel yana kaymıyor, birim görünüyor. 1024'te de panel 264 px içinde (`board-1024-light.png`).
2. **Bildirim paneli örtmüyor**: "İç köşeye 4 mm yarıçaplı taşma açıldı." tuvalin altında (x = 543–897), panel alanları açık. Durum çubuğundaki imleç koordinatını kısa süre örtüyor; kabul edilebilir.
3. **İlk tık tam milimetreye oturuyor**: köşeler "700 / 700" (önce "604,56 / 402,34"). Koordinat hâlâ tahta koordinatı; cila kuyruğundaki madde yarı yarıya çözüldü.
4. **"Diz" tıkı gitti** (T261).

Kalanlar (hepsi cila kuyruğunda yazılı, yeniden açılmadı): parça %18 ölçekte çiziliyor ve "Tümünü göster" plakayı kadrajlıyor, dik parçada beş kez açı yazılıyor, köşe numarası yuvarlamadan sonra değişiyor ("Köşe 4" → "Köşe 5"), dikdörtgenden L yapılamıyor.

Yeni (B12 ile geldi): seçili parçada her kenarın uzunluk etiketi çıkıyor; %39'da 200 × 150'lik konsolda etiketler ("150", "110", "40", "200") birbirinin ve parçanın üstüne biniyor, tutamaçlarla birlikte parça görünmüyor (`board-corner-1440-light.png`; 1024'te %16'da `board-1024-light.png`). Büyük parçada sorun yok. Cila.

## Önizleme ile dosya ayrışıyor: profil sürümü (yeni, şimdi düzelt)

Proje, oluşturulduğu makine profili sürümüne bağlı kalıyor ve dışa aktarma o sürümle yapılıyor (doğru ve yazılı davranış). Ama 1. adım ve Simülasyon makinenin **son** sürümünü kullanıyor. Makine formunda herhangi bir kayıt yeni sürüm ürettiği için (bu incelemede "Kesim ayarı ekle" akışı tek başına iki sürüm üretti) fark kolayca oluşuyor.

Ölçüm: dolap projesi sürüm 1 ile kayıtlı. Makinede MDF 18 mm pasosu 6 → 9 yapıldı (sürüm 4).

| Ekran | Gösterdiği |
| --- | --- |
| 1. adım (`wizard-step1-profile-old-1440-light.png`) | "Örnek router (Mach3) · sürüm 4", "Kesim ayarı: … 9 mm paso", sağ üstte "Sorun yok"; mavi kutu "Dışa aktarma projenin sürümüyle (sürüm 1) yapılır. [Son sürüme geç]" |
| Simülasyon (`sim-profile-version-1440-light.png`) | "sürüm 4", panelde "(PROFIL: … surum 4)", ilk dalma `G1 Z-6.1666`, 24 paso, ≈ 10 dk 1 sn, "Tüm kontroller geçti"; sürüm farkından söz yok |
| Dışa aktar (`export-profile-version-1440-light.png`) | "profil sürüm 1"; küçük sarı satır "Proje profil sürüm 1 ile kaydedildi; son sürüm 4. Dosya proje sürümüyle üretilir." |
| İnen dosya | "(PROFIL: … surum 1)", ilk dalma `G1 Z-4.6250`, 32 paso (simülasyonun dediğinden 3 dk uzun) |

Aynı fark pencereli kapak projesinde de görüldü (simülasyon 21 paso, dosya 28 paso; `sim-inners-ok-1440-light.png`).

Neden "şimdi": operatör bir programı izleyip onaylıyor, makineye başka bir program gidiyor. Ters yönde güvenlik sorunu: operatör takım kırdıktan sonra pasoyu düşürür, simülasyonda düşük pasoyu görür, indirdiği dosya eski derin pasoyla keser; onu durduran tek şey Dışa aktar'daki küçük sarı satır. Sunucudaki kontroller gerçek dosyada çalıştığı için dosya kural dışı değil; yanlış olan önizlemenin ve "Tüm kontroller geçti" rozetinin başka bir programa ait olması. B13r'nin "panel inen dosyayla aynı başlığı gösterir" sözü de bu durumda tutmuyor.

## İç kesim, ölçü ve liste eşlemesi (B12)

İş: 596 × 716 kapağa bir pencere (300 × 250), bir küçük kare (80 × 80) ve bir yuvarlak delik; tahtada dikdörtgen ve çember araçlarıyla.

İyi olan:

- **Çizilen şekil soruluyor** (`board-inner-prompt-1440-light.png`): parça içinde kapanan şekil "İç kesim olarak ekle?" penceresini açıyor; "Ayrı parça olarak ekle" de var. Ölçü iki değerle yazılıyor ("300 Tab 250 Enter").
- **Takıma sığmayan açıklık yerinde reddediliyor**: 6 × 6 için "İç kesim 8 mm takım için çok küçük ya da çok dar." bildirimi; listeye girmiyor.
- **G-code doğru** (`Pencereli_kapak_S1.tap`, elle okundu): üç iç kontur kapağın dış konturundan önce kesiliyor; takım merkezi açıklığın 4 mm içinde (80 × 80 için 72 × 72); 80 × 80 göbekte 4, 300 × 250 göbekte 4, Ø35 göbekte yay üzerinde 2 köprü (Z-15, D-049). Göbek kesim bitince serbest kalmıyor; kural G-code'a doğru iniyor.
- **Kalıcı ölçü** (`board-dim-1440-light.png`): iki tıkla "100" ölçüsü uzatma çizgileriyle duruyor, panelde "Ölçüler → Ölçü 1 100 ✕"; kesim listesindeki ölçüyü değiştirmiyor.
- **Seçim iki görünümde ortak**: tahtada seçilen parça listede işaretli geliyor (`cutlist-with-inners-1440-light.png`).

Sorunlar:

1. **Köprü sığmayan küçük iç kesim ilk kez 4. adımda kilitliyor** (şimdi düzelt). Ø24 delik (8 mm takımla menteşe, kablo, havalandırma deliği boyu) tahtada uyarısız ekleniyor; panelde "İç kontur 3", listede "Sorun yok", Dizilim'de "Sorun bulunmadı", adım göstergesinde dört onay işareti. Simülasyon'da kırmızı kutu: "Bu dosya indirilemez … İç kesimden düşecek küçük parçaya (göbek) 2 köprü sığmıyor; kesici onu fırlatabilir. Açıklığı büyütün ya da cep olarak boşaltın (cep boşaltma yakında)." (`sim-blocked-slug-1440-light.png`, `export-blocked-slug-1440-light.png`). Kutu hangi parça ve hangi iç kesim olduğunu söylemiyor ("Plaka 1 · Tüm program"), tek bağlantısı "Makineler sayfası" (sorun makinede değil, çizimde), hemen altındaki kart "Uyarılar: Sorun bulunmadı." diyor, önerilen çözümlerden biri henüz yok. Engelin kendisi doğru (D-049, güvenlik); yeri ve anlatımı D-045'e aykırı ("sorunu doğduğu adımda yakala"). Aynı kutu doğrulanmamış kesim ayarında doğru çalışıyor: 1. adımda kırmızı nokta, her adımda görünür (`sim-unverified-set-1440-light.png`).
2. **İç kesim eklendikten sonra düzenlenemiyor.** Kenarına tıklamak parçayı seçiyor, içine tıklamak seçimi bırakıyor; panelde yalnızca "İç kesim 1 300 × 250 ✕" var. Taşıma, ölçü değiştirme, "kenardan 100 mm" yazma yok; yanlış yere çizilen pencere silinip yeniden çiziliyor ve konum fareyle, tahta koordinatında veriliyor. Delik ve cep (B14) için en değerli cila adayı.
3. **Pencere düğmesi taşıyor, odak "Vazgeç"te** (`board-inner-prompt-1440-light.png`): pencere 448 px (x = 944'te bitiyor), "İç kesim olarak ekle" düğmesi x = 962'de bitiyor. Açılışta odak "Vazgeç"te; denemede Enter hiçbir düğmeyi çalıştırmadı (pencere açık kaldı). Arka plan bulanık olduğu için kullanıcı az önce çizdiği şekli göremiyor. Her iç kesimde yeniden soruluyor.
4. **İç kesim boşluk gibi görünmüyor** (`board-inners-zoom-1440-light.png`, `board-inners-1440-dark.png`, `layout-inners-1440-light.png`): tahtada, Dizilim'de ve Simülasyon'da açıklık parça rengiyle dolu, yalnızca çizgisi var; parça etiketi ("1 Kapak 596 × 716") pencerenin üst kenarına biniyor. %18'de pencerenin kenar etiketleri iç içe ("2 300 3").
5. **Kesim listesi iç kesimi söylemiyor** (`cutlist-with-inners-1440-light.png`): üç açıklığı olan kapak düz bir dikdörtgen satırı; listeye bakan kişi parçanın işlendiğini bilemiyor.
6. **Uyarı parça adı vermiyor**: geçen dosyada "1 uyarı → Köprü sayısı azaltıldı." (`sim-inners-ok-1440-light.png`); hangi parça ya da iç kesim olduğu yok.
7. **İç konturda giriş yayı yok** (G-code okuması): dış konturlar yay ile giriyor (`G3 … I-4`), iç konturlar kenarın ortasında doğrudan dalıyor (`G1 Z-4.6250 F1500`, sonra aynı noktadan kesim). Güvenlik sorunu değil (dalma hızıyla), ama dalma izi pencerenin görünen kenarında kalır. Göbek tarafından giriş ya da rampa B14 (cep) ile birlikte ele alınmalı; golden dosyaları etkiler.

## "Kesim ayarı ekle" ve doğrulanmamış ayar (B12a)

Üç görev de ölçülerek doğrulandı:

- **T264 aynı projeye dönüş**: malzeme seçildikten hemen sonra (kayıt beklemeden) "Kesim ayarı ekle"ye basıldı; makine formunun adresi `/makineler?duzenle=…&ayar=acrylic-5&donus=/projeler/<id>…`, "Projeye dön" aynı projeyi Akrilik 5 mm ile açtı, proje sayısı +1.
- **T265 körlemesine kayıt yok** (`machine-params-unverified-1440-light.png`, `machine-params-unverified-1440-dark.png`): satır 5.000 mm/dk · 18.000 dev/dk · **5 mm paso** (önce 6) ile geliyor, odak "Besleme"de, "Paso" ve "Takım no" 1440'ta görünüyor; altında "Başlangıç değerleri; bu malzeme için doğrulanmadı. Kendi makinenizde doğrulayın. [Değerleri doğruladım]". Onaysız kaydedilince: 1. adımda kırmızı kutu "… doğrulanmadı. Bu haliyle G-code üretilemez … [Kesim ayarını doğrula]" ve kırmızı nokta (`wizard-step1-unverified-1440-light.png`), Dizilim ve Simülasyon'da aynı hata, İndir kapalı (`sim-unverified-set-1440-light.png`), Malzemeler'de "Doğrulanmadı" çipi (`materials-unverified-1440-light.png`). Onay 4 tık (Kesim ayarını doğrula → Değerleri doğruladım → Kaydet → Projeye dön); sonra kontroller geçti ve dosya indi.
- **T266 köşe araçları**: Gezinti 2'de.

Kalan (cila): 1024 × 768'de düzeltme akışıyla gelindiğinde "Değerleri doğruladım" düğmesi (y = 728–760) yapışkan kayıt çubuğunun altında, not yarım görünüyor (`machine-params-unverified-1024-light.png`); sayfa kaydırılınca erişiliyor. Tablo genişliği ve "Takımlar" vurgusu zaten kuyrukta.

## Dar ekran ve simülasyon başlığı (B13r)

| Ölçü | 1280 × 800 | 1024 × 768 | Hedef (T263) |
| --- | --- | --- | --- |
| Tahta tuvali | 654 × 570 | 590 × 485 | 640 × 520 / 580 × 480 |
| Dizilim tuvali | 654 × 607 | 590 × 522 | 640 × 520 / 580 × 480 |
| Simülasyon tuvali | 654 × 411 | 590 × 326 | 640 × 380 / 580 × 300 |

Çalışma adımlarında kenar menüsü simge şeridine iniyor (64 px), başlık 1280'de tek satır (`board-1024-light.png`, `layout-cabinet-1024-light.png`, `sim-cabinet-1024-light.png`). Malzemeler 1024'te sayfa düzeyinde kaymıyor, "Sil" x = 935–975'te görünüyor (`materials-unverified-1024-light.png`). İnceleme #4 ve #5'in "1024'te tuval küçük" riski kapandı.

Telefon (390 × 844) duman testi: ana sayfa, 1. adım, kesim listesi, tahta, Dizilim, Simülasyon (açık ve kilitli), Dışa aktar, Malzemeler, Makineler ve Projeler'de sayfa düzeyinde yatay kayma 0 px; "İleri" (x = 293, y = 792) ve "İndir" her adımda erişilebilir.

## G-code okuması (dört dosya)

`Mutfak_alt_dolap_60_S1.tap`, `Raf_konsolu_S1.tap`, `Pencereli_kapak_S1.tap`, Akrilik 5 mm deneme dosyası. Hepsinde: ilk satır "(DOGRULANMADI, once air cut)"; `G21 G90 G91.1 G17 G40 G49 G54`; XY hareketinden önce `G0 Z20`; takım sorusu + `M0`; ilk dalmadan önce `M3 S18000` ve `G4 P5.0`; malzemeye yalnızca `G1` ile ve dalma hızıyla (F1500) giriliyor, eksi Z'de `G0` yok; en derin Z = kalınlık + 0,5 (−18,5 / −5,5); köprüler Z-15 (akrilikte Z-2,5); son satırlar `G0 Z20 · M5 · M9 · M30`. Açık bir güvenlik sorunu görülmedi.

Not: akrilikte ilk paso (Z-2,75) köprü aralıklarında Z-2,5'e 0,25 mm kalkıp iniyor; zararsız, dosyayı uzatıyor.

## İyi olanlar (koruyun)

- **Doğrulanmamış ayarın izi her adımda**: kırmızı nokta, aynı cümle, tek düğme, aynı projeye dönüş. "Sorunu doğduğu yerde yakala" kuralının en iyi örneği; küçük iç kesim de bu kalıba oturmalı.
- **Kendiliğinden dizilim ve gerçek dosya başlığı**: iyi yolda adımlar arası sürtünme kalmadı.
- **İç kesim sorusu ve D-049 köprüleri**: marangozun düşünme biçimiyle ("içine pencere çiz") güvenlik kuralı aynı akışta.
- **Köşe grubu görünür alana geliyor**; bildirim tuvalin altında.
- **Simge şeridi**: dar ekranda tuvale yer açıyor, kullanıcının kendi seçimi korunuyor.

## Şimdi düzelt (D-047: en çok 3 görev, her biri en çok yarım gün)

İki görev önerildi; üçüncü hak kullanılmadı. Numaraları PO verir.

### A. Simülasyon ve 1. adım, dosyanın üretileceği profil sürümünü gösterir

Neden "şimdi": yanlış çıktı / makine güvenliği (önizlenen program ile inen program farklı).

Spec: §3.7, §9, §2.4 · Depends: T258, T262 · Decision: D-045

Acceptance:
- [ ] proje sürüm N'ye bağlıyken makine sürüm N+1'e geçmiş ve MDF 18 mm pasosu değişmişse, Simülasyon'un G-code panelindeki ilk 12 satır, paso sayısı ve tahmini süre inen dosyayla aynıdır (bugün: panel "surum 4", `G1 Z-6.1666`, 24 paso, ≈ 10 dk; dosya "surum 1", `G1 Z-4.6250`, 32 paso)
- [ ] 1. adımdaki makine satırı ve "Kesim ayarı: …" cümlesi projenin sürümündeki değerleri gösterir (bugün "sürüm 4 … 9 mm paso", dosya 6 mm ile kesiyor); Dizilim'deki "Takım Ø" çipi de aynı sürümden gelir
- [ ] sürüm farkı varken 1. adımdaki "Makine profili güncellendi … [Son sürüme geç]" kutusu Simülasyon ve Dışa aktar adımlarında da görünür (aynı düğme, tek geri alma adımı); düğmeden sonra üç adım da son sürümü gösterir ve dosya son sürümle iner
- [ ] yarım günü aşarsa en küçük çözüm: sürüm farkı varken Simülasyon önizleme üretmez, kutuyu ve "Son sürüme geç" düğmesini gösterir (yanlış program hiç gösterilmez)
- [ ] golden G-code dosyaları ve dışa aktarma davranışı (dosya projenin sürümüyle üretilir) değişmez

Tester focus: proje oluştur, makinede MDF pasosunu değiştirip kaydet, projeyi aç: panel metni ile inen dosyanın ilk 12 satırı ve paso sayısı, "Son sürüme geç"ten önce ve sonra; "Kesim ayarı ekle" dönüşü (`?profil=son`) bozulmadı.

### B. Köprü sığmayan iç kesim çizildiği adımda yakalanır

Neden "şimdi": kilitleyen akış geç ve adressiz ortaya çıkıyor (D-045); kullanıcı 4. adımda hangi parçayı düzelteceğini bilmiyor.

Spec: §4.3, §6.3, §3.7 · Depends: T134, T258 · Decision: D-049, D-045

Acceptance:
- [ ] göbeğine 2 köprü sığmayan bir iç kesim (8 mm takımla Ø24 çember) eklendiğinde Parçalar adımında hata görünür: özellikler panelinde o iç kesimin satırında ve kesim listesi sorun çipinde ("Sorun yok" demez); metin parçayı ve iç kesimi adıyla söyler ("Kapak · İç kesim 3: …"). Kural toolpath'teki `SMALL_SLUG_UNSECURED` ile aynı çekirdek fonksiyondan gelir
- [ ] adım göstergesinde Parçalar adımı kırmızı noktayı taşır ve nokta Dizilim, Simülasyon ve Dışa aktar'da görünür kalır (doğrulanmamış kesim ayarındaki davranışın aynısı)
- [ ] Simülasyon ve Dışa aktar'daki kırmızı kutu bu hata için parça ve iç kesim adını yazar; bağlantısı "Makineler sayfası" değil, Parçalar → Çizim'i o parça seçili açar; aynı ekrandaki "Uyarılar" kartı "Sorun bulunmadı." demez
- [ ] metinde henüz olmayan çözüm önerilmez ("cep boşaltma yakında" kalkar ya da B14 gelene kadar "açıklığı büyütün ya da silin" olur)
- [ ] D-049 kuralı, eşikler ve golden dosyalar değişmez; Ø35 ve 80 × 80 bugünkü gibi köprüyle geçer

Tester focus: Ø24 ve Ø35 çember, 80 × 80 kare; her adımda nokta ve metin; bağlantının açtığı görünüm ve seçili parça; iç kesim silinince hatanın her yerden kalkması; 1440 ve 1024; axe.

Zaten yazılı olup bu incelemede teyit edilenler (yeni görev yok): T261, T262, T263 kapandı; T264–T266 kapandı.

## Cila kuyruğu (D-047)

PO'nun `docs/BACKLOG.md` "Polish queue (M9; D-047)" bölümüne eklemesi için (inceleme BACKLOG'a dokunmadı):

- Tahta: iç kesim eklendikten sonra seçilemiyor, taşınamıyor, ölçüsü ve parçaya göre konumu yazılamıyor; yalnızca silinip yeniden çiziliyor. B14 (delik, cep) öncesi en değerli aday (inceleme metni, B12 madde 2)
- "İç kesim olarak ekle?" penceresi: ana düğme pencereden 18 px taşıyor (pencere x = 944, düğme x = 962); odak "Vazgeç"te ve Enter düğmeyi çalıştırmıyor; bulanık arka plan çizilen şekli gizliyor; her iç kesimde yeniden soruluyor (`board-inner-prompt-1440-light.png`)
- Tahta, Dizilim, Simülasyon: iç kesim parça rengiyle dolu, boşluk gibi görünmüyor; parça etiketi açıklığın üstüne biniyor (`board-inners-zoom-1440-light.png`, `layout-inners-1440-light.png`)
- Tahta: seçili küçük parçada kenar uzunluğu etiketleri birbirinin ve parçanın üstüne biniyor (%39'da 200 × 150 konsol; %18'de pencere "2 300 3"); etiketleri ölçeğe göre gizle ya da dışarı taşı (`board-corner-1440-light.png`, `board-inners-1440-dark.png`)
- Kesim listesi: iç kesimi olan satırda işaret yok (ör. "3 iç kesim" çipi) (`cutlist-with-inners-1440-light.png`)
- Simülasyon: "Köprü sayısı azaltıldı." uyarısı parça ya da iç kesim adı vermiyor (`sim-inners-ok-1440-light.png`)
- Takım yolu: iç konturda giriş yayı / rampa yok, dalma izi açıklığın görünen kenarında kalır; B14 ile birlikte, golden etkisiyle değerlendirilsin (G-code okuması)
- Takım yolu: çok pasolu kesimde köprü yüksekliğinin üstündeki pasolar da köprü aralığında 0,25 mm kalkıp iniyor (akrilik 5 mm: Z-2,75 → Z-2,5); gereksiz hareket (G-code okuması)
- Makine formu, 1024: düzeltme akışıyla gelindiğinde "Değerleri doğruladım" düğmesi yapışkan kayıt çubuğunun altında kalıyor; satırı çubuğun üstüne kaydır (`machine-params-unverified-1024-light.png`)
- Kesim listesi: dolap bildirimi "5 satır eklendi", düğme "7 parça ekle"; aynı birimi kullan (`cutlist-cabinet-1440-light.png`)
- Dışa aktar: profil sürümü farkı küçük sarı bir satır; A görevi sonrası kutu olarak kalmalı (`export-profile-version-1440-light.png`)

İnceleme #5 kuyruğundan kısmen çözülen: "köşe X / Y ondalıklı" (ilk tık artık tam mm; parçaya göre koordinat hâlâ yok).

## Karar verildi (sahibi isterse değiştirir)

Yeni kural yok. Aşağıdakiler var olan kuralların uygulamasıdır:

- **K1 (D-045 ölçüsü):** gezinti tabanı güncellendi: dolap işi **16 tık / 5 değer**; L konsol **22 tık / 12 değer**.
- **K2:** proje profil sürümüne bağlı kalır, dışa aktarma o sürümle yapılır (değişmedi). Değişen: önizleme de aynı sürümü kullanır; sürümü değiştiren tek şey kullanıcının "Son sürüme geç" tıkıdır.
- **K3 (D-049'un devamı):** köprü sığmayan küçük göbek engeli ve eşikleri değişmez; yalnızca hatanın gösterildiği yer öne çekilir. 8 mm takımla Ø24 gibi delikler B14'e (delik / cep) kadar kesilemez; metin bunu dürüstçe söyler.
- **K4:** iç konturda giriş yayı ve iç kesimin düzenlenmesi cila kuyruğunda; PO isterse B14 ile alır. İnceleme "şimdi" yapmadı çünkü çıktı güvenli ve iş bitiyor.

## Çıktılar

- `docs/reviews/2026-11-19-cto-design-review-6.md` ve `docs/reviews/2026-11-19-cto-6/` (28 görüntü).
- `docs/BACKLOG.md` ve `docs/DECISIONS.md`: değişmedi (triyaj PO'da).

## Görüntüler

Klasör: `docs/reviews/2026-11-19-cto-6/` (28 dosya; 1440 × 900 ve 1024 × 768).

| Ekran | Dosyalar |
| --- | --- |
| Çizim tahtası | `board-l-closed-1440-light.png`, `board-corner-1440-light.png`, `board-dogbone-1440-light.png`, `board-1024-light.png`, `board-inner-prompt-1440-light.png`, `board-inners-zoom-1440-light.png`, `board-inners-1440-dark.png`, `board-dim-1440-light.png` |
| Kesim listesi | `cutlist-cabinet-1440-light.png`, `cutlist-with-inners-1440-light.png` |
| Dizilim | `layout-cabinet-1024-light.png`, `layout-inners-1440-light.png` |
| Simülasyon | `sim-cabinet-1440-light.png`, `sim-cabinet-1440-dark.png`, `sim-cabinet-1024-light.png`, `sim-inners-ok-1440-light.png`, `sim-blocked-slug-1440-light.png`, `sim-unverified-set-1440-light.png`, `sim-profile-version-1440-light.png` |
| Dışa aktar | `export-blocked-slug-1440-light.png`, `export-profile-version-1440-light.png` |
| 1. adım | `wizard-step1-unverified-1440-light.png`, `wizard-step1-profile-old-1440-light.png` |
| Makine formu | `machine-params-unverified-1440-light.png`, `machine-params-unverified-1440-dark.png`, `machine-params-unverified-1024-light.png` |
| Ayarlar → Malzemeler | `materials-unverified-1440-light.png`, `materials-unverified-1024-light.png` |
