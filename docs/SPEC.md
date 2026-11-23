# NittCam — Proje Dokümanı v3

Nov 16, 2026 · @Sadettin · v3: 17 Kasım 2026

## 1. Özet

NittCam, CNC router kullanan atölyeler için web tabanlı CAM ve üretim planlama yazılımıdır. Girdi kesim listesi, çizim, DXF veya AI sohbettir; çıktı plaka dizilimi, takım yolu ve makine profiline uygun G-code, DXF ve PDF'tir.

- **Durum:** M0 ve M1 tamamlandı (17 Kasım 2026); v3 planıyla M2–M9 sürüyor. Yan proje, tek geliştirici, Claude Code ile AI destekli kodlama.
- **Önceki ad:** SmartNest CAM. Güncel ad: NittCam.
- **Slogan:** "Teknik çizim yapma, üretim tarifini ver."
- **Değişmez kural:** AI geometri veya G-code üretmez. Makineye kritik her işlem deterministik kodla yapılır ve üretilen G-code geri okunarak denetlenir.
- **Hedef:** konuşulan tüm özellikler ilk sürümde. Geliştirme milestone'lara bölünür (bölüm 12).

### v1 dokümanından bu yana değişenler

| Konu | v1 | v2 kararı | Neden |
| --- | --- | --- | --- |
| Geliştirme sırası | Önce tüm editör, makine testi M2 sonunda | Önce ince dilim: kesim listesi → dizilim → G-code → air cut | En kritik risk yanlış G-code; gerçek makineye en erken çıkılmalı |
| Hedef kitle | Fason ve tabela listede, DXF içe aktarma kapsam dışı | DXF içe aktarma ilk sürümde | Fason kesimci ve tabelacı DXF ile çalışır |
| Çekirdek motor dili | Python (FastAPI, Shapely, rectpack, Jinja2) | TypeScript çekirdek paket, hem tarayıcıda hem sunucuda çalışır | Canlı editörde anında doğrulama, tek şema, ileride offline sürüm |
| Geometri temsili | Tanımsız (Shapely çok parçalı çizgi) | Yaylı çoklu çizgi (bulge polyline) | DXF ile aynı model, G2/G3 doğrudan çıkar, yay uydurma gerekmez |
| Post processor | Jinja2 şablonu | Bildirimsel (declarative) post ayarı + sürümlü referans dosyalar | Controller henüz bilinmiyor; ayar değiştirerek uyarlanabilmeli |
| Yerel kayıt | Dexie.js ikinci kaynak gibi | Sunucu tek kaynak; yerelde yalnızca gönderilmemiş değişiklik kuyruğu | "Tek doğru kaynak" kuralı bozulmasın |
| Makine profili | Z sıfır referansı ve orijin köşesi yok | Eklendi (bölüm 7.1) | Takım kırdıran en yaygın hata kaynağı |
| Yeni özellikler | — | Kesim listesi yapıştırma, artık parça stoğu, parça etiketi, kenar bandı, dogbone, küçük parça güvenliği | Bölüm 2.4 |

### v3 değişiklikleri (17 Kasım 2026, sahibin kararı)

M0 ve M1 bitti. Sahibin geri bildirimi üzerine kapsam ve sıra değişti (kararlar: DECISIONS D-032…D-036).

| Konu | v2 | v3 kararı | Neden |
| --- | --- | --- | --- |
| Saha testi zamanı | M1 sonunda Saha 1, M3 sonunda Saha 2 | Tek saha testi, ürün ~%90 bittiğinde (M9 sonu); Saha 1 ve Saha 2 birleşti | Sahip makine testini neredeyse bitmiş ürünle yapmak istiyor |
| Milestone sırası | Hesap → editör → şablon/dizilim → AI → 3D | Tasarım sistemi → kesim listesi + damar → çizim tahtası → delik/şablon/DXF → 3D → dizilim → export → cila → saha; hesap ve AI sahadan sonra | Sahip için değer sırası; her yeni ekran yeni tasarımla yapılır |
| Damar yönü | 0°/90°; serbest açı kapsam dışı | Serbest açılı damar: plaka ve parça başına açı kadranı (bölüm 3.6, 6.2) | Sahibin talebi |
| Gerçek şekil nesting | Sonraki sürüm | M7'de: serbest şekil, DXF parçaları ve açılı damarlı parçalar için | Açılı damar ve çizilen parçalar sınırlayıcı kutuyla çok fire verir |
| Arayüz | Basit Tailwind sayfaları | Kurumsal, modern tasarım sistemi: belirteçler, açık/koyu tema, uygulama kabuğu, komut paleti, bildirimler (bölüm 3.7) | Sahip: "demode, kurumsal değil" |
| 3D önizleme | M6 sonunda, açılı hafif hareketli plaka | M6'da tam 3D: 360° döndürme, plakayı taşıma, kalınlık, delik/cep, takım yolu, kesim oynatma, parça ayırma (bölüm 3.8) | Sahibin talebi |
| Kesim listesi | Tablo + Excel yapıştırma | Satır içi düzenleme, çoğalt, toplu düzenleme, CSV/XLSX dosya, malzeme kütüphanesi, basit parametrik dolap kutusu | "Kesim listesi sadece Excel" eleştirisi |
| Görev boyu | Görev başına bir PR | Küçük görevler, 2–4 görevlik paketler (batch), paket başına bir PR | Developer bir çalışmada daha çok iş bitirsin |

Eski milestone adlarının yeni karşılıkları bölüm 12.1'dedir.

Controller markası hâlâ bilinmiyor. Bu yüzden M1 genel bir "düz G-code" post ayarıyla başlar ve makine bilgisi gelince uyarlanır (bölüm 12.3'teki bilgi toplama listesi).

## 2. Ürün, hedef kitle ve kapsam

### 2.1 Çözülen problemler

- CAD/CAM lisansları pahalı, arayüzleri karmaşık, operatör eğitimi gerekiyor.
- Eski atölye bilgisayarlarında ağır yazılım çalışmıyor.
- Nesting ve fire hesabı elle yapılıyor.
- Aynı işler (menteşe çukuru, kulp deliği, desen) her projede baştan çiziliyor.
- Her makine için farklı çıktı formatı gerekiyor, üretim bilgisi standartlaşmıyor.

Kurulum gerekmez, tarayıcıdan çalışır. CNC makinesi internete bağlanmaz; dosya USB ile aktarılır.

### 2.2 Hedef kitle

| Segment | İlk sürümde ne alır | Sınır |
| --- | --- | --- |
| KOBİ mobilya ve panel işleme atölyeleri | Kesim listesi, parametrik parça, şablon, nesting, G-code | Birleştirme (joinery) ve dolap tasarımı yok |
| Fason CNC kesim işletmeleri | DXF içe aktarma, katmana göre işlem atama, nesting (M7'den itibaren gerçek şekil), G-code | Serbest şekilli cep ve parça-içi-parça sınırlı |
| Reklam / tabela üreticileri | DXF'ten harf ve şekil kontur kesimi | V-oyma, yazı aracı ve serbest şekilli cep yok; yazı DXF'te eğriye çevrilmiş gelmeli |

Başlangıç makine segmenti: düz G-code kullanan routerlar (Mach3, Syntec, NcStudio gibi controller'lar). Kendi program formatı olan makineler (Biesse CIX, Homag woodWOP MPR, SCM Xilog) kapsam dışıdır; bu müşterilere DXF/PDF export ile hizmet verilir.

### 2.3 İlk sürüm kapsamı

- Giriş ekranı, üyelik, şirket, roller (Yönetici / Operatör) (v3: saha testinden sonra, M10)
- Menü: Ana sayfa, Makineler, Projeler, Şablonlar, Oluştur, Ayarlar
- Kurumsal, modern tasarım sistemi; açık/koyu tema; komut paleti (v3, bölüm 3.7)
- Makine yönetimi, makine ve takım profili, manuel bakım takibi
- Oluştur sihirbazı: makine, malzeme, kalınlık, plaka ölçüsü, damar yönü
- Kesim listesi tablosu ve Excel/CSV yapıştırma; satır içi düzenleme, toplu düzenleme, CSV/XLSX dosya, malzeme kütüphanesi, basit parametrik dolap kutusu (v3)
- 2D çizim editörü: parametrik parçalar, serbest şekiller, özellikler paneli, köşe yuvarlama, dogbone
- Delik nesnesi (cep / geçme / kanal)
- DXF içe aktarma (bölüm 4.6'daki sınırlarla)
- Şablonlar ve şablon güncelleme akışı
- Nesting, 3 dizilim modu, serbest açılı damar yönü, gerçek şekil nesting, artık parça stoğu (v3)
- Takım offset'i, tab, kesim sırası, lead-in/out, çok paso, küçük parça güvenliği
- Tek controller ailesi ve tek post processor ile başlangıç
- G-code geri okuyucu, önizleme ve simülasyon
- Test programı (air cut) ve doğrulama ekranları
- NC, DXF, PDF export; parça etiketi; proje kaydı, kopyalama, export geçmişi
- AI sohbet (komut katmanı üzerinden)
- Giriş animasyonu, 3D önizleme (360°, kesim oynatma), kamera geçişi

### 2.4 v2'de eklenen özellikler

| Özellik | Ne yapar | Milestone |
| --- | --- | --- |
| Kesim listesi yapıştırma | Excel/CSV'den ad, en, boy, adet, damar sütunlarını tabloya alır; AI gerekmez | M1 |
| Makine profilinde Z sıfır ve orijin | Z sıfırı tabla mı malzeme üstü mü, orijin hangi köşe | M1 |
| Küçük parça güvenliği | Eşik altındaki parçalara otomatik tab veya son pasoda ince tabaka bırakma | M1 (tab), M5 (ince tabaka) |
| Parça numarası ve etiket | PDF'te ve dizilim görünümünde parça numarası; etiket sayfası | M8 |
| DXF içe aktarma | Fason ve tabela işleri için hazır çizimi alma | M5 |
| Dogbone / T-bone | Geçmeli parçalarda iç köşeyi takım yarıçapı kadar taşırır | M4 |
| Artık parça stoğu | Kalan dikdörtgen plakayı kaydeder, sonraki işte önce onu kullanır | M7 |
| Serbest açılı damar (v3) | Plaka ve parça için açı kadranı; dizilim parçayı damara göre döndürür | M3 (gerçek şekil M7) |
| Tasarım sistemi (v3) | Kurumsal görünüm, açık/koyu tema, komut paleti, bildirimler | M2 |
| Parametrik dolap kutusu (v3) | En/boy/derinlikten yan, üst, alt, raf, arkalık ve kapak parçalarını üretir; birleştirme yok | M3 |
| Kenar bandı bilgisi | Parça kenarı başına bant kalınlığı; kesim ölçüsünden düşme seçeneği | M1 (bilgi), M7 (düşme) |

### 2.5 Başlangıçta dışarıda

- 3D CAM, çok eksenli CNC, malzeme kaldırma (voxel) simülasyonu (3D önizleme ve kesim oynatma kapsamda, bölüm 3.8)
- Mermer/taş malzeme (arayüzde "yakında")
- DWG içe aktarma; DXF'te yazı, ölçü, tarama ve blok içi blok
- V-oyma, yazı aracı, serbest şekilli cep boşaltma
- Birden fazla controller ailesi
- Kendi formatı olan makineler için doğrudan dosya üretimi
- Karmaşık birleştirme (joinery), kural tabanlı akıllı şablonlar, genel kısıt çözücü
- Tam ERP, stok, sipariş yönetimi, teklif/maliyet, QR etiket
- Gerçek çalışma saatine dayalı bakım takibi
- Offline masaüstü uygulaması

## 3. Ekranlar ve kullanıcı akışı

### 3.1 Kullanıcı akışı

1. Giriş yap (şirket hesabı, kullanıcı/operatör).
2. Makineler sayfasından makine ekle (marka, model, controller, çalışma alanı, takımlar).
3. Oluştur: makine, malzeme, kalınlık, plaka ölçüsü, damar yönü.
4. Parçaları gir: kesim listesi yapıştır, çiz, DXF al, şablon ekle veya AI'a söyle.
5. Dizilim modunu seç (en az fire / en hızlı / en az takım değişimi).
6. Önizleme ve simülasyon ekranında kontrol et.
7. Export al: NC/G-code, DXF veya PDF.
8. Dosyayı USB ile makineye aktar.
9. Makine doğrulama durumunu güncelle.

### 3.2 Giriş ekranı

- Ekran ikiye bölünür: solda %60 hafif animasyon, sağda %40 beyaz zeminde sade giriş formu.
- Animasyon: dikdörtgen parçaların plakaya yavaşça yerleşmesi, üzerinden takım yolu çizgisinin geçmesi (SVG/Canvas).
- Animasyon sekme gizliyken durur, tablet ve küçük ekranda kapanır, "hareketi azalt" ayarına uyar.
- Form: e-posta, şifre, "şifremi unuttum". Tanıtım sitesine link.
- Ortak atölye bilgisayarları için oturum süresi ve hızlı kullanıcı değiştirme.

### 3.3 Ana yapı ve menü

- Solda dikey menü (açık temada hafif kırık beyaz, koyu temada koyu yüzey; ikonlu, daraltılabilir; 768 px altında çekmece). Sol üstte şirket logosu, altında giriş yapan operatörün adı.
- Menü: Ana sayfa, Makineler, Projeler, Şablonlar, Oluştur, Ayarlar.
- Oluştur ana eylemdir; menü öğesine ek olarak belirgin bir "+ Yeni proje" butonu bulunur.
- Proje ekranında sağ altta AI sohbet paneli (bölüm 5).

### 3.4 Sayfalar

| Sayfa | İçerik |
| --- | --- |
| Ana sayfa | Son projeler, doğrulama bekleyen makineler, fire özeti |
| Makineler | Liste, ekle / çıkar / düzenle, makine ve takım profili, doğrulama durumu, manuel bakım kaydı (son bakım tarihi, aralık, hatırlatma) |
| Projeler | Liste (ad, durum: taslak / üretildi / tamamlandı, makine, malzeme, tarih), arama ve filtre, açma, kopyalama, export geçmişi, yeniden export |
| Şablonlar | Şirket şablonları, hazır kütüphane (menteşe, kulp, çekmece rayı) |
| Artık parçalar | Kayıtlı artık plakalar: malzeme, kalınlık, ölçü, damar, kaynak proje (M7; Projeler altında sekme) |
| Ayarlar | Şirket bilgileri, malzeme kütüphanesi ve varsayılanları, DXF katman eşleme, görünüm (tema, yoğunluk, 3D basit mod); kullanıcılar/roller ve abonelik M10 ve sonrası |

Gerçek çalışma saati ölçülmez, çünkü makine internete bağlı değildir.

### 3.5 Roller

- **Yönetici:** makineler, şablon oluşturma/düzenleme, malzeme varsayılanları, kullanıcılar, abonelik.
- **Operatör:** proje oluşturma, şablon kullanma, export.

### 3.6 Oluştur sihirbazı

Ekranda ikinci bir sol panel (adımlar ve alanlar) ve sağda önizleme bulunur. Üstte adım göstergesi ve geri/ileri vardır. Taslak otomatik kaydedilir.

1. **Makine ve plaka.** Makine seçimi tabla ölçüsünü, takımları ve post processor'ı belirler. Plaka tablaya sığmıyorsa uyarı.
2. **Parçalar.** Kesim listesi tablosu ve çizim editörü aynı veriyi gösteren iki görünümdür.
3. **Dizilim.** Mod seçimi, parça arası boşluk, kenar payı, artık parça kullanımı.
4. **Önizleme / simülasyon.** Üretilen G-code'dan çizilir (bölüm 6.5).
5. **Export.**

Plaka adımı alanları:

- **Malzeme:** ahşap (MDF, kontrplak, melamin, masif), plastik (akrilik, PVC). Mermer/taş "yakında".
- **Kalınlık:** kesim derinliği ve paso sayısı buna bağlıdır.
- **Ölçü:** hazır plaka ölçüleri (ör. 1220×2440, 2100×2800) ve özel ölçü. Önizleme canlı şekil alır.
- **Damar yönü:** yalnızca ahşap ve kaplamalı malzemede görünür. **Açı kadranı (v3):** dairesel kadranda tutamaç sürüklenir veya derece yazılır; 0°/45°/90°/135° katlarına ±3° içinde yapışır (Alt ile kapatılır); hızlı butonlar 0° / 45° / 90° / 135°; klavye okları ±1°, Shift ile ±15°. Damar yönsüzdür: 30° ile 210° aynıdır, açı 0–180° aralığında saklanır. Aynı kadran parça başına damar için de kullanılır (bölüm 4.1, 6.2).
- **Malzeme = parametre seti:** her malzeme ve kalınlık için besleme, devir, paso derinliği, önerilen takım, tab ayarı varsayılanları. Şirket bunları kendi makinesine göre düzenler.

Önizleme M1'de 2D'dir. M6'da tam 3D önizleme eklenir (bölüm 3.8); 2D/3D arasında geçilir, "İleri" denince kamera yumuşak geçişle kuşbakışı görünüme döner. Düşük performanslı bilgisayarlar için basit mod ve 2D'ye düşüş kalır.

### 3.7 Tasarım sistemi ve arayüz (v3)

Hedef: kurumsal, profesyonel, modern ve kolay kullanılan bir arayüz. Her ekran aynı bileşen ve belirteçlerden kurulur.

- **Belirteçler:** renk ölçekleri ve anlamsal roller (zemin, yüzey, kenar, metin, vurgu, odak, başarı/uyarı/hata), yarıçap, boşluk, gölge, yazı ölçeği, hareket süreleri. Tek dosyada, açık ve koyu tema değerleriyle.
- **Tema:** sistem / açık / koyu; yüklemede yanıp sönme yok. Canvas ve 3D renkleri de belirteçlerden gelir.
- **Yazı:** Inter (veya Geist), ölçüler için eşit genişlikte rakamlar.
- **Kabuk:** daraltılabilir ikonlu sol menü, üst çubuk (yol, sayfa başlığı, kayıt durumu, tema), 768 px altında çekmece menü.
- **Komut paleti:** Ctrl/Cmd+K ile sayfaya git, yeni proje, son projeler, tema; "?" ile kısayol listesi. Kısayollar tek kayıttan gelir.
- **Geri bildirim:** bildirim (toast), boş durum, hata durumu, iskelet yükleme; Türkçe 404 ve hata sayfaları.
- **Erişilebilirlik:** tüm akış klavyeyle yapılabilir; görünür odak; AA kontrast her iki temada; "hareketi azalt" ayarına uyulur.
- **Duyarlı tasarım:** 390 / 768 / 1024 / 1440 px; atölye tableti için en az 40 px dokunma hedefi; sayfa düzeyinde yatay kaydırma yok.
- **Görsel kalite güvencesi:** her ekran 1440 ve 390 px'te, açık ve koyu temada ekran görüntüsüyle ve axe erişilebilirlik taramasıyla test edilir (bölüm 11).

### 3.8 3D önizleme (v3)

- **Görünüm:** tabla ve plaka gerçek ölçü ve kalınlıkta; 360° döndürme, yakınlaştırma, kaydırma; Üst / İzometrik / Ön hazır görünümler.
- **Plakayı taşıma:** kullanıcı plakayı tabla üzerinde sürükleyip bakabilir. Bu yalnızca görünümdür; dizilimi ve makine ofsetini değiştirmez.
- **Parçalar:** dış kontur kalınlıkta, iç konturlar ve geçme delikler boşluk, kör cep ve kanallar çukur olarak görünür. Parça seçilince bilgi kartı (numara, ad, ölçü, damar). "Ayır/kaldır" ile parçalar plakadan kaldırılır; fire gizlenebilir.
- **Malzeme ve damar:** MDF, kontrplak, melamin, akrilik dokuları kodla üretilir (görsel indirilmez); damar çizgileri plaka açısına ve parçanın etkin damar açısına göre döner; bantlı kenarlar renklidir.
- **Takım yolu ve kesim oynatma:** okunan G-code'dan çizilir (bölüm 6.5); 2D simülasyonla aynı oynatıcıya bağlıdır; takım hareket eder, kesim izi ilerledikçe açılır. "Simülasyon air cut'ın yerine geçmez" uyarısı burada da görünür.
- **Montaj görünümü:** parametrik dolap kutusundan gelen parçalar kutu hâlinde gösterilebilir (birleştirme detayı yok).
- **Performans:** 300 parçada döndürürken en az 45 fps, yüklemeden sonra ilk kare ≤ 1,5 sn. WebGL2 yoksa veya fps düşükse basit moda, gerekirse 2D'ye düşer. 3D kodu yalnızca açıldığında yüklenir.
- **Sınır:** 3D önizleme malzeme kaldırma simülasyonu değildir; kesim izi takım yolundan çizilir.

## 4. Parça girişi ve çizim editörü

### 4.1 Kesim listesi

Kesim listesi, parçaların tablo görünümüdür: ad, en, boy, adet, damar kilidi, kenar bandı. Excel veya CSV'den kopyalanan satırlar tabloya yapıştırılır; sütunlar otomatik eşlenir, kullanıcı onaylar. Birim (mm/cm) belirsizse sorulur. Tablodaki her satır editörde parametrik dikdörtgen parçadır.

v3 eklemeleri:

- Satır içi düzenleme (tıkla/Enter, Tab, oklar, Esc), Türkçe ondalık virgül, hücre başına doğrulama; her düzenleme tek geri alma adımıdır.
- Çoğalt, sil, çoklu seçim, toplu düzenleme (adet, damar, kenar bandı, ad öneki); alt bilgide toplam parça, alan ve tahmini plaka sayısı.
- CSV/XLSX dosyadan içe aktarma ve CSV dışa aktarma; gruplama, arama, sıralama, filtre (yalnızca görünüm, proje sırası değişmez).
- Damar sütunu: serbest/sabit ve açı; düzenleme açı kadranıyla (bölüm 3.6).
- Malzeme kütüphanesi: malzeme türü, kalınlıklar, stok plaka ölçüleri, varsayılan damar açısı, makineye göre parametre seti (Ayarlar → Malzemeler).
- **Parametrik dolap kutusu:** en, boy, derinlik, kalınlık, arkalık, raf sayısı, kapak sayısı ve süpürgelik yüksekliğinden yan, üst, alt, raf, arkalık ve kapak parçaları üretilir; damar ve bant varsayılanlarıyla kesim listesine tek adımda eklenir. Birleştirme (joinery) ve kural tabanlı akıllı şablon yoktur (bölüm 2.5).

### 4.2 Editör geneli

- Üstten kuşbakışı 2D Canvas editör: seçme, hizalama, ölçü, sürükleme.
- Kullanım aşırı basit olmalı. İlk kullanımda kısa tanıtım turu ve ipuçları.
- Geometrinin tek doğru kaynağı proje JSON'udur (bölüm 9). Her düzenleme bir komuttur (bölüm 5.1).
- Doğrulama ve offset aynı çekirdek kodla tarayıcıda anında, export sırasında sunucuda yeniden çalışır.

### 4.3 Nesne türleri

1. **Parametrik parça** (dolap kapağı, raf, panel): en, boy, köşe yuvarlama, adet, damar. Özellikler panelinden düzenlenir. Dik açılarını korur; "serbest şekle dönüştür" ile çizgi ve yaylara çevrilir.
2. **Serbest şekil:** çizgi ve yaylardan oluşan kapalı kontur. İç konturlar (pencere, boşluk) desteklenir.
3. **Delik nesnesi** (bölüm 4.5).
4. **Şablon grubu** (bölüm 4.7).

### 4.4 Çizim araçları ve özellikler paneli

- Kolay çizgi çekme, çizgiye eğim verme, köşelere yapışma (snap), 45°/90° kilidi.
- Çizerken sayı yazıp Enter ile uzunluk girme.
- Yakınlaştırma/kaydırma, geri al/yinele, ekranda ölçü etiketleri, kopyala, aynalama.
- Bir çizgiye basınca sol panelde bilgileri açılır: uzunluk, açı, yay yarıçapı. Buradan düzenlenebilir.
- AI'ın veya şablonun çizdiği parçada da çizgi aynı şekilde düzenlenir.

Kurallar:

- **Uzunluk değişimi:** çizgi uzunluğu değişince son köşe aynı yönde kayar, komşu çizgi onu takip eder. Genel kısıt çözücü yoktur.
- **Köşe yuvarlama:** keskin köşe yay olur. Yarıçap komşu çizgilerden büyükse sınırlanır ve uyarılır.
- **İç köşe:** içbükey köşenin minimum yarıçapı takım yarıçapıdır. Editör uyarır veya otomatik düzeltir. Dış köşe keskin kalabilir.
- **Dogbone / T-bone:** seçilen iç köşede takım yarıçapı kadar taşma açılır; parça geçmeli birleşimde tam oturur.
- **Kapalı kontur:** yakın uçlar tolerans içinde otomatik birleşir. Açık kalan şekilde "kesilemez, kapalı değil" uyarısı.

### 4.5 Delik nesnesi

Çap girildikçe delik canlı büyür. "İçini boşalt" kutucuğu iki türü ayırır; etiketler kullanıcı dilindedir ("İçini boşalt" / "Sadece çember (kanal)").

| Tür | Ne yapar | Ayarlar |
| --- | --- | --- |
| Cep (içi dolu, kör) | Çapın tamamı belirli derinliğe boşaltılır. Menteşe kovanı bu türdür. | Çap, derinlik (mm) |
| Geçme (içi dolu) | Çapın tamamı malzeme boyunca boşaltılır. | Çap |
| Kanal (sadece çember) | Çember boyunca halka kanal açılır. | Çap, kanal genişliği, derinlik |

Kurallar:

- Çap takım çapından küçük olamaz. Çap takıma eşitse tek dalma veya delik döngüsü, büyükse spiral/halka yolu.
- Kör derinlik malzeme kalınlığından küçük olmalı; çok yakınsa uyarı.
- Geçme için hedef derinlik = kalınlık + fire tabla payı (makine profilinde).
- Kanal genişliği takım çapına eşitse tek geçiş, büyükse çok geçiş; küçükse uyarı.
- Delik ve cepler önce, dış kontur en son işlenir. Büyük geçme deliklerde tab düşünülür.
- Delikler parçaya bağlıdır; nesting parçayı döndürürse birlikte döner.
- Delik döngüsü (G81/G83) makine profilindeki "delik döngüsü desteği" alanına göre post processor tarafından seçilir.

Veri: tür, çap, merkez (parçaya göre X/Y), derinlik, kanal genişliği, takım.

### 4.6 DXF içe aktarma

DXF dosyası parçaya çevrilir; içe aktarma bir önizleme ve onay ekranından geçer.

- **Desteklenen:** LINE, ARC, CIRCLE, LWPOLYLINE (bulge ile), POLYLINE, tek seviye INSERT (blok).
- **Dönüştürülen:** SPLINE ve ELLIPSE toleransla çizgi/yaya çevrilir; kullanıcıya bildirilir.
- **Yok sayılan:** TEXT/MTEXT, DIMENSION, HATCH. Sayısı raporlanır.
- **Birim:** dosyadaki birim okunur; yoksa veya şüpheliyse (ör. parça 2 mm çıkıyorsa) sorulur.
- **Birleştirme:** uçları tolerans içinde (varsayılan 0,05 mm) olan parçalar kapalı kontura birleştirilir. Kapanmayanlar işaretlenir.
- **Parça tanıma:** en dıştaki kapalı kontur parça, içindekiler iç kontur veya delik sayılır. Daireler delik nesnesine çevrilebilir.
- **Katman eşleme:** katman adı işleme eşlenir (dış kesim, iç kesim, cep, delik, çizgi üzerinden). Eşleme şirket ayarı olarak saklanır.
- **DWG:** desteklenmez; kullanıcıya DXF olarak kaydetmesi söylenir.

"Çizgi üzerinden" işlemi (takım merkezi çizgiyi izler, belirli derinlik) tabelacı için basit kazıma sağlar.

### 4.7 Şablonlar

Tekrar eden işler (menteşe çukuru, kulp deliği, çekmece rayı delikleri, desen) şablon olarak kaydedilir.

- **Şablon:** parametreli grup (delikler, çizgiler, kanallar). Parametreler: çap, kenardan mesafe, adet, aralık.
- **Oluşturma:** çizimde seçili nesneleri "şablon olarak kaydet". Yönetici oluşturur ve düzenler, operatör kullanır.
- **Yerleştirme:** "şablon ekle" → hayalet önizleme gelir, kenar ve köşelere yapışır, kenar mesafesi sayıyla girilir. Aynalama (sol/sağ açılan kapak), döndürme ve eşit aralıklı tekrar.
- **Kopya ve sürüm:** şablon projeye kopyalanır; proje şablonun o anki hâlini ve sürümünü saklar. Şablon sonradan değişince eski projeler etkilenmez.
- **Güncelleme akışı:** eski proje açıldığında şablon değişmişse sorulur: "Kullanılan menteşe şablonu değişti. Güncellensin mi?" Hayır: proje aynı kalır. Evet: ölçüler güncellenir, geri alınabilir. Kullanıcının elle değiştirdiği alanlar için çakışma uyarısı.
- **Hazır kütüphane:** menteşe, kulp, çekmece rayı. Ölçüler üretici teknik verisinden doğrulanır (açık madde).

Şirket şablonları aboneliğin kalıcılığını artırır.

### 4.8 Kenar bandı

Parçanın her kenarına bant kalınlığı atanabilir. Proje ayarı: girilen ölçü bitmiş ölçü mü (bant kalınlığı kesimden düşülür) yoksa kesim ölçüsü mü. PDF parça listesinde bantlı kenarlar işaretlenir.

## 5. Komut katmanı ve AI sohbet

### 5.1 Komut katmanı (mimari karar)

Proje verisini değiştiren her şey bir komuttur. Arayüz butonları, kesim listesi tablosu, DXF içe aktarma ve AI aynı komutları çağırır.

Her komutun dört parçası vardır:

1. **Şema:** parametrelerin tipi ve sınırları (Zod).
2. **Uygulama:** proje JSON'unu saf fonksiyonla değiştirir; yan etki yoktur.
3. **Geri alma:** değişiklik yaması (patch) saklanır; geri al/yinele buradan çalışır.
4. **Kayıt:** kim yaptı (kullanıcı / AI), ne zaman, hangi komut.

Komuttan sonra kural doğrulama çalışır ve uyarı listesi güncellenir. Komut şemaları AI'a araç tanımı olarak aynen verilir; AI için ayrı bir arayüz yazılmaz.

İlk komut seti:

| Alan | Komutlar |
| --- | --- |
| Plaka ve makine | `setMachine`, `setMaterial`, `setThickness`, `setSheetSize`, `setGrain` |
| Parça | `addPart`, `updatePart`, `removePart`, `duplicatePart`, `importCutList`, `importDxf` |
| Geometri | `addSegment`, `setSegmentLength`, `setSegmentBulge`, `moveVertex`, `filletCorners`, `addDogbone`, `convertToFreeform` |
| Delik ve işlem | `addHole`, `updateHole`, `removeHole`, `setOperation` |
| Şablon | `addTemplate`, `updateTemplateInstance`, `saveAsTemplate` |
| Dizilim | `setNestingMode`, `setNestingOptions`, `runNesting`, `lockPlacement` |

### 5.2 AI sohbet: yerleşim

- Proje ekranında sağ altta bağımsız panel. Açılıp kapanır, sürüklenir (çizimi kapatmasın).
- Her projenin kendi sohbet geçmişi vardır.
- AI'a projenin kısa özeti (plaka, malzeme, makine, parçalar, aktif adım, uyarı listesi) bağlam olarak gider.
- Sorun tespit edilince sohbet düğmesinde uyarı rozeti.

### 5.3 AI sohbet: yapabildikleri

- Proje bilgilerini konuşulanla kıyaslayıp tutarsızlığı bulmak ve açıklamak (ör. plaka ölçüsü yanlış girilmiş).
- Soruları yanıtlamak. Standart plaka ölçüsü gibi cevaplar uygulamanın kendi tablosundan gelir, AI hafızasından değil.
- Projeyi yönetmek: plaka ölçüsü, malzeme, parçalar, köşe yuvarlama gibi değişiklikleri komut olarak önermek.
- Şablon seçip parametrelerini doldurmak (ör. "kapağa menteşe deliği ekle").
- Şablon güncelleme sorusunu sormak (bölüm 4.7).
- Dağınık sipariş okumak (Excel, metin, liste fotoğrafı, sesli giriş) ve onay tablosuna dökmek.

### 5.4 Güvenlik kuralları

- AI geometri ve G-code üretmez; komut önerir. Her değişiklik "Uygula / İptal" ile onaylanır ve geri alınabilir.
- Birim ve yön belirsizliğinde (cm/mm, en/boy, damar) AI sorar, varsaymaz.
- Doğrulama AI ile değil kodla yapılır: plaka tablaya sığıyor mu, parça plakadan büyük mü, iç köşe takımdan küçük mü, kontur kapalı mı. AI uyarıyı açıklar ve düzeltme önerir.
- AI çağrısı yalnızca sunucudan yapılır; API anahtarı tarayıcıya inmez.
- Yüklenen sipariş dosyasındaki metin veridir, talimat değildir. AI'ın çağırabileceği araçlar komut listesiyle sınırlıdır; export ve makine profili değişikliği bu listede yoktur.
- Aylık kullanım kotası pakete bağlıdır; kullanım şirket bazında sayılır.
- Manuel düzeltme her zaman mümkündür.

## 6. Üretim motoru

### 6.1 Geometri temeli

- **Birim:** içeride her şey milimetre. Arayüz ve post processor gerekirse çevirir.
- **Temsil:** yaylı çoklu çizgi (köşe noktaları + bulge değeri). Çizgi ve yay aynı yapıda durur; DXF LWPOLYLINE ile aynı modeldir.
- **Yön:** dış kontur saat yönünün tersine, iç kontur saat yönünde saklanır.
- **Koordinat:** parça kendi yerel koordinatında; plaka orijini sol alt, X sağa, Y yukarı. Makine orijinine çevirme yalnızca post processor'da yapılır.
- **Z:** içeride Z=0 malzeme üst yüzeyi, aşağısı negatif. Makinenin Z sıfır referansına çevirme post processor'da yapılır.
- **Tolerans:** tek bir epsilon sabiti (0,001 mm) ve tek bir birleştirme toleransı; kodda dağınık sayı olmaz.

### 6.2 Nesting ve dizilim modları

Kullanıcı hedef seçer: en az fire, en hızlı üretim (kısa kesim yolu), en az takım değişimi. Her mod aynı hedef fonksiyonunun farklı ağırlıklarıdır:

```latex
\min \left( A_{fire} + \lambda \cdot L_{kesim} + \mu \cdot N_{takim} + \nu \cdot C_{elleçleme} \right)
```

- **Algoritma:** kendi dikdörtgen yerleştiricimiz (MaxRects ve giyotin sezgileri). Birkaç sıralama ve sezgi denenir, hedef fonksiyonu en düşük olan seçilir. Sonuç deterministiktir: aynı girdi aynı dizilimi verir.
- **Serbest şekil ve DXF parçaları:** M7'ye kadar sınırlayıcı dikdörtgeniyle, M7'den itibaren gerçek şekille dizilir (v3). Gerçek şekil motoru: parça izi = kontur + takım yarıçapı + boşluk/2; deterministik sol-alt yerleştirme ve kesin çokgen çakışma testi; isteğe bağlı küçük parçayı büyük iç boşluğa yerleştirme. Dikdörtgen ve eksene hizalı işler MaxRects ile kalır.
- **Boşluklar:** takım çapı, parça arası boşluk ve plaka kenar payı hesaba katılır.
- **Damar kuralı (v3, serbest açı):** plakanın damar açısı θp (0–180°, yoksa damar yok) ve parçanın kendi çerçevesinde damar açısı θ ve modu (serbest / sabit) vardır. Sabit parça yalnızca (θ + dönüş) ≡ θp (mod 180°) sağlayan iki açıda yerleşir: g = θp − θ ve g + 180°. Serbest parça 0°/90°/180°/270° döner (gerçek şekilde ayarlanabilir adım). Kural motorda uygulanır, AI yalnızca alanı doldurur.
- **Eksene hizalı olmayan açı:** g 90°'nin katı değilse parça döndürülmüş yerleşir. M7'ye kadar döndürülmüş konturun eksene hizalı sınırlayıcı kutusu dizilir ve ek fire bilgi olarak gösterilir; M7'de gerçek şekil motoru kullanılır. Takım yolu, post ve kontroller her açıyı destekler.
- **Çoklu plaka:** parçalar sığmazsa yeni plaka açılır; plaka sayısı raporlanır.
- **Artık parça:** aynı malzeme ve kalınlıktaki kayıtlı artıklar önce denenir. Dizilim sonunda eşik üstü (varsayılan 300×300 mm) dikdörtgen artık, kullanıcı onayıyla stoğa kaydedilir.
- **Elle müdahale:** kullanıcı bir parçayı sürükleyip kilitleyebilir; yeniden dizilim kilitli parçalara dokunmaz.

### 6.3 Takım yolu

- **Offset:** takım merkezi yolu parça sınırından takım yarıçapı kadar kaydırılır. Dış kontur dışarıdan, iç kontur ve delik içeriden. Offset yayları yay olarak korur.
- **İşlem türleri:** dış kesim, iç kesim, çizgi üzerinden, dairesel cep, halka kanal, delme.
- **Kesim sırası:** önce delik ve cep, sonra iç kontur, en son dış kontur. Küçük parçalar büyüklerden önce kesilir (vakum hâlâ güçlüyken).
- **Derinlik:** paso derinliğine göre çok paso. Geçme kesimde hedef = kalınlık + fire tabla payı.
- **Giriş/çıkış:** lead-in ve lead-out (yay veya düz). Dalma düz veya rampalı.
- **Tab:** tutucu köprüler; adet, genişlik ve yükseklik ayarlanır. Tab köşeye konmaz; düz kenar tercih edilir, düz kenara sığmayan küçük parçada (disk, "O" harfi) tab, yarıçapı takım yarıçapından büyük tek bir yumuşak yayın üstüne konur; köşe yayına (kenarlar arası ≤ 90° yuvarlatma) hiç konmaz (T272, T284, D-058).
- **Küçük parça güvenliği:** alanı eşiğin altındaki parçaya otomatik tab eklenir. İkinci seçenek: son pasoda ince tabaka bırakıp en sonda temizleme pasosu.
- **Yön:** climb / conventional seçimi.
- **Rapid sıralama:** aynı takımın işlemleri gruplanır; kesimler arası boş hareket en yakın komşu sezgisiyle kısaltılır.

Çıktı, makineden bağımsız bir takım yolu modelidir: takım, hareket türü (rapid, dalma, kesim, yay), koordinat, besleme, devir. Post processor bunu makine formatına çevirir.

### 6.4 Post processor

Post processor kod değil, sürümlü bir ayar dosyası ve onu yorumlayan tek bir üreticidir. Yeni controller eklemek çoğu zaman yalnızca yeni ayar dosyası demektir.

Ayar dosyasının tanımladıkları:

- Program başlangıcı ve sonu, yorum söz dizimi (`( )` veya `;`), satır numarası (var/yok, artış)
- Birim ve mod satırları (G21, G90, G17, G54 vb.)
- Takım değiştirme: otomatik (`T.. M6`), elle (duraklat ve mesaj) veya yok (takım başına ayrı dosya)
- Spindle aç/kapa, devir, ısınma beklemesi (dwell söz dizimi: saniye mi milisaniye mi)
- Rapid ve lineer hareket biçimi, ondalık basamak sayısı
- Yay: I/J (artımlı veya mutlak) ya da R; tam daire desteği; yay yoksa çizgiye bölme
- Delik döngüsü desteği (G81/G83) ya da açık hareketlerle delme
- Vakum ve makineye özel M kodları
- Dosya uzantısı, dosya adı uzunluk sınırı, satır sonu (CRLF/LF), dosya boyutu sınırı ve bölme

Her post ayarı sürümlenir (ör. "Syntec – NittCam v1.0"). Her sürümün referans (golden) G-code dosyaları repoda durur; çıktı değişirse test kırılır.

### 6.5 G-code geri okuyucu, önizleme ve simülasyon

Üretilen G-code metni bağımsız bir okuyucuyla yeniden çözülür. Hem otomatik kontroller hem simülasyon bu okunan veriden çalışır; kullanıcı makinenin gerçekte yapacağını görür.

Otomatik kontroller (biri başarısızsa export engellenir):

- Plaka ve tabla sınırı dışına çıkma, eksen ve Z limiti
- Güvenli Z ihlali: malzeme içinde rapid hareket
- Spindle kapalıyken kesim hareketi, besleme tanımsız kesim
- Takım değiştirme sırası ve takım numarası
- Okunan yolun takım yolu modeliyle tolerans içinde eşleşmesi
- Parça sayısı ve konumlarının dizilimle uyumu

Simülasyon ekranı (2D üstten, Canvas):

- Plaka, parçalar, damar oku, fire alanı, makine sıfır noktası ve tabla sınırı
- Takım merkezi yolu ve takım çapı kadar yarı saydam daire
- Rapid (kesikli) ve kesim hareketleri, yön okları, kesim sırası numaraları
- Z derinliği (renk veya yan görünüm)
- Oynat/durdur, hız, kaydırma çubuğu, oynatılan G-code satırı vurgusu
- Özet: tahmini süre, kesim uzunluğu, takım değişim sayısı. Süre yaklaşıktır, saha ölçümüyle kalibre edilir.

3D önizleme aynı okunan veriyi ve aynı oynatıcıyı kullanır (bölüm 3.8).

Export öncesi kontrol listesi: orijin doğru mu, takım doğru mu, air cut yapılacak mı. Ekranda açıkça yazar: simülasyon air cut'ın yerine geçmez.

### 6.6 Export ve raporlar

- **NC/G-code:** uzantı makine profilinden (.nc, .tap vb.). Dosya başına yorum: proje, revizyon, post sürümü, doğrulama durumu.
- **DXF:** dizilim ve parçalar; katmanlar işlem türüne göre.
- **PDF:** plaka dizilimi, numaralı parça listesi, bantlı kenarlar, fire raporu, etiket sayfası.
- **Rapor:** fire yüzdesi ve alanı, plaka sayısı, tahmini kesim süresi, parça listesi.

Her export sunucuda, kaydedilmiş proje revizyonundan yeniden üretilir ve saklanır: proje revizyonu, makine profili sürümü, post sürümü, dosya özeti (hash). Aynı girdi her zaman aynı dosyayı verir. Export türleri pakete göre açılır (bölüm 13).

## 7. Makine profili, G-code güvenliği ve doğrulama

### 7.1 Makine profili

| Grup | Alanlar |
| --- | --- |
| Kimlik | Marka, model, controller ailesi ve sürümü |
| Çalışma alanı | X, Y, Z hareket sınırları; tabla ölçüsü |
| Orijin (yeni) | Program sıfırı hangi köşe; eksen yönleri; plakanın tabladaki yeri |
| Z sıfır referansı (yeni) | Tabla yüzeyi mi, malzeme üst yüzeyi mi; fire tabla payı |
| Spindle | Güç, min/max devir, ısınma beklemesi |
| Takım değiştirici | Otomatik / elle / yok; kapasite; takım boyu telafisi (G43 var/yok) |
| Tutma | Vakum, mengene veya T-slot; vakum M kodları |
| Program biçimi | Post ayarı ve sürümü (bölüm 6.4) |
| Kısıtlar | Dosya adı uzunluğu, dosya boyutu, yay desteği, satır numarası, delik döngüsü |

- **Takım profili:** takım no, tip, çap, kesici boyu, ağız sayısı.
- **Kesim parametreleri:** güvenli Z, kesim derinliği, paso derinliği, besleme, dalma hızı, devir. Varsayılanlar malzeme parametre setinden gelir.
- **Makine kütüphanesi:** marka/model/controller seçilince varsayılan profil dolar, kullanıcı eksikleri doğrular. Kütüphane marka üzerinden değil controller ailesi üzerinden kurulur.

### 7.2 G-code güvenlik kuralları (pazarlık dışı)

Bu kurallar üreticide uygulanır ve geri okuyucuda ayrıca denetlenir.

1. Program hiçbir modal durumu varsaymaz: birim, mutlak/artımlı, düzlem ve iş koordinatı başta açıkça yazılır.
2. İlk hareket güvenli Z'ye çıkıştır. XY rapid yalnızca güvenli Z'de yapılır.
3. Malzemeye rapid ile girilmez; dalma her zaman dalma hızıyla yapılır.
4. Spindle açılmadan ve ısınma beklemesi bitmeden kesim hareketi olmaz.
5. İlk kesim hareketinde besleme açıkça yazılır.
6. Tüm koordinatlar çalışma alanı içindedir; dışına çıkan program üretilmez.
7. Program sonunda güvenli Z'ye çıkılır, spindle ve vakum kapatılır, program bitiş kodu yazılır.
8. Sayılar sabit ondalıkla yazılır; üstel gösterim, NaN veya boş değer çıktıya giremez.
9. Geri okuyucu kontrolleri geçmeyen dosya indirilemez.
10. Doğrulanmamış profilde dosya başına "DOĞRULANMADI, önce air cut" yorumu eklenir; indirme uyarı ve kabul ister.

### 7.3 Doğrulama sistemi

Platform makinede ne olduğunu göremez. "Doğrulanmış" etiketi kanıta dayalı kullanıcı beyanıdır; platform süreci yönetir ve sonucu kaydeder.

Makine profili durumları:

1. **Taslak:** profil oluşturuldu, test yok.
2. **Air cut onaylandı:** test dosyası havada çalıştırıldı; eksenler, spindle, güvenli Z doğru.
3. **Test kesimi onaylandı:** fire plakada gerçek kesim yapıldı, ölçüler girildi.
4. **Doğrulanmış:** ölçüler tolerans içinde.

Test programı:

- İçerik: takım değiştirme, spindle start, güvenli X/Y ve Z hareketleri, küçük test geometrisi, spindle stop, program sonu.
- Air cut: Z yukarıda veya spindle kapalı; malzemeye temas yok.
- Test parçası: 200×200 mm kare, ortada 100 mm delik, bir kör cep.
- Kullanıcı kumpasla ölçtüğü değerleri forma girer: kenarlar, köşegen, delik çapı, cep derinliği (Z sıfır hatasını yakalar).
- Platform toleransla karşılaştırır; fark varsa takım çapı telafisi veya Z düzeltmesi önerir.

Kurallar:

- **Sürüm bağlama:** doğrulama; makine profili, takım seti ve post sürümüne bağlıdır. Biri değişirse durum "yeniden doğrulama gerekli" olur.
- **İki seviye:** "NittCam test etti" (geliştiricinin kendi makinelerinde) ve "Kullanıcı onaylı" (müşterinin makinesinde).
- **Etiket dili:** "Test edildi" / "Kullanıcı onaylı". "Garantili" denmez.
- **Hukuki zemin:** kullanım şartları, sorumluluk sınırı ve "ilk çalıştırmada air cut zorunlu" ifadesi (bölüm 13.5).

## 8. Mimari ve teknoloji

Çekirdek motor tek bir TypeScript paketidir. Aynı kod tarayıcıda anında geri bildirim için, sunucuda yetkili export için çalışır.

&#91;embedded content: mimari · 3 katman, 8 adımlı çekirdek\]

Vurgulu kutu güvenlik kapısıdır: üretilen G-code geri okunur, kontrolleri geçmeyen dosya ne simülasyona ne export'a ulaşır.

### 8.1 Veri akışı

1. Kullanıcı girişi: kesim listesi, çizim, DXF veya AI sohbet.
2. Komut katmanı: arayüz ve AI aynı komutları çağırır.
3. Proje JSON'u: tek doğru kaynak, sürümlü şema.
4. Şema ve kural doğrulama: uyarı ve hata listesi.
5. Geometri: offset, takım telafisi, iç köşe kuralları.
6. Nesting: plakalara yerleşim.
7. Makineden bağımsız takım yolu modeli.
8. Makine profili + post ayarı → G-code metni.
9. G-code geri okuyucu → otomatik kontroller ve simülasyon.
10. Export: NC / DXF / PDF, kayıt ve dosya özeti ile.

### 8.2 Mimari kurallar

- **Çekirdek saftır:** `packages/core` içinde ağ, veritabanı, tarih, rastgelelik ve arayüz kodu yoktur. Aynı girdi aynı çıktıyı verir.
- **AI çekirdeğe giremez:** AI yalnızca komut önerir; çekirdek paketin AI bağımlılığı yoktur.
- **Sunucu yetkilidir:** tarayıcıdaki hesap önizlemedir. İndirilen her dosya sunucuda, kayıtlı revizyondan yeniden üretilir.
- **Tek kaynak:** proje sunucuda saklanır, her kayıt revizyon numarasını artırır. Eski revizyon üzerine yazma reddedilir (iyimser kilit). Yerelde yalnızca gönderilmemiş komut kuyruğu tutulur.
- **Ağır iş arayüzü kilitlemez:** nesting ve takım yolu tarayıcıda Web Worker içinde çalışır.
- **Şema sürümlüdür:** proje JSON'u `schemaVersion` taşır; eski projeler göç (migration) fonksiyonlarıyla açılır.
- **Metinler koddan ayrıdır:** tüm arayüz metni çeviri dosyasındadır (önce Türkçe, sonra İngilizce).

### 8.3 Teknoloji yığını

| Katman | Seçim | Not |
| --- | --- | --- |
| Dil ve repo | TypeScript (strict), pnpm workspace monorepo | Tek dil, tek şema |
| Arayüz | Next.js (App Router), React, Tailwind CSS |  |
| Arayüz durumu | Zustand + Immer yamaları | Geri al/yinele komut yamalarından |
| 2D editör ve simülasyon | Konva (react-konva) | Performans yetmezse özel Canvas katmanı |
| Arayüz bileşenleri (v3) | Radix primitifleri üzerine kendi bileşenlerimiz (shadcn tarzı, `packages/ui`), class-variance-authority, tailwind-merge | Bileşen kodu bizde; MIT |
| İkon, palet, bildirim, tema (v3) | lucide-react, cmdk, sonner, next-themes | ISC / MIT |
| Tablo (v3) | TanStack Table + TanStack Virtual | Kesim listesi; MIT |
| Yazı tipi (v3) | Inter veya Geist, `next/font` ile; PDF'e gömülü | OFL-1.1 |
| 3D önizleme | three, @react-three/fiber, @react-three/drei | M6; yalnızca açılınca yüklenir; doku kodla üretilir; MIT |
| Şema ve doğrulama | Zod | Komut şemaları AI araç tanımına çevrilir |
| Offset | CavalierContours (WASM) adayı; yedek Clipper2 + yay uydurma | M0'da deneme görevi ile karar |
| Nesting | Kendi MaxRects / giyotin yerleştiricimiz | Damar, artık parça ve mod kontrolü için |
| Post processor | Kendi üreticimiz + bildirimsel ayar dosyaları | Jinja2 yerine |
| G-code geri okuyucu | Kendi ayrıştırıcımız | Üreticiden bağımsız yazılır |
| DXF | Okuma için dxf-parser adayı; yazma için kendi yazıcımız | Lisans ve bakım durumu M0'da doğrulanır |
| PDF | pdf-lib + gömülü font | Türkçe karakter için font gömülür |
| Sunucu | Next.js route handler'ları | Ayrı backend servisi yok |
| Veritabanı | PostgreSQL + Drizzle ORM | Proje JSON'u `jsonb` sütununda |
| Kimlik | Better Auth (şirket ve rol desteğiyle) adayı | M10 başında doğrulanır |
| Dosya depolama | S3 uyumlu object storage | Export dosyaları |
| AI | Anthropic API, araç çağrısı (tool use), yalnızca sunucudan | M11 |
| Test | Vitest, fast-check, Playwright, @axe-core/playwright | Bölüm 11; axe-core MPL-2.0, yalnızca geliştirme bağımlılığı (D-032) |
| CI | GitHub Actions | Her PR'da |

Lisans kuralı: MIT, BSD, Apache-2.0, BSL-1.0 kabul; GPL ve AGPL bağımlılık alınmaz. "Aday" yazan kütüphanelerin lisansı, bakım durumu ve tarayıcıda çalışması M0'da doğrulanır; uymazsa yedeğe geçilir.

### 8.4 Neden Python'dan TypeScript'e

- Editör her düzenlemede offset ve kural kontrolü ister. Sunucuya gidip gelmek gecikme ve çevrimdışı kırılganlık demektir.
- İki dilde iki şema (Pydantic + TypeScript) tek geliştirici için sürekli senkron yüküdür.
- Shapely yayları korumaz; G2/G3 için ayrıca yay uydurma gerekir.
- İleride offline masaüstü sürümü, çekirdek zaten tarayıcıda çalıştığı için yeniden yazım gerektirmez.

Bedeli: Shapely ve rectpack gibi olgun kütüphaneler yerine offset kütüphanesi seçimi ve kendi yerleştiricimiz gelir. Bu risk M0 deneme görevi ve özellik tabanlı testlerle sınırlanır.

### 8.5 Ortamlar ve barındırma

- **Yerel:** Docker Compose ile PostgreSQL ve S3 uyumlu depo (MinIO). Tek komutla ayağa kalkar.
- **Önizleme:** her PR için otomatik önizleme ortamı (barındırma seçilince).
- **Canlı:** barındırma kararı M10'da verilir. KVKK yurt dışı aktarım kuralları kararı etkiler (bölüm 13.5); açık madde.

### 8.6 Güvenlik ve çok şirketli yapı

- Her tabloda `company_id` bulunur; her sorgu oturumdaki şirketle filtrelenir. Bu kural testle denetlenir.
- Rol kontrolü sunucuda yapılır; arayüzde gizlemek yeterli sayılmaz.
- Sırlar yalnızca ortam değişkeninde durur, repoya girmez.
- Günlük veritabanı yedeği; export dosyaları silinmez, sürümlenir.
- Yüklenen dosyalar (DXF, Excel, fotoğraf) boyut ve tür sınırından geçer.

## 9. Veri modeli

### 9.1 Veritabanı tabloları

| Tablo | Tuttuğu şey | Önemli alanlar |
| --- | --- | --- |
| `companies` | Şirket (kiracı) | ad, logo, paket, AI kotası |
| `users` | Kullanıcı | şirket, rol (yönetici / operatör), e-posta. M10'dan itibaren kişi birden çok şirkette olabilir: şirket ve rol üyelik tablosuna (`company_members`) taşınır (D-113) |
| `machines` | Makine | şirket, marka, model, bakım kaydı |
| `machine_profile_versions` | Profilin değişmez sürümleri | makine, sürüm no, profil JSON'u, post ayarı ve sürümü |
| `tools` | Takım seti | makine, takım no, tip, çap |
| `materials` | Malzeme parametre setleri | şirket, tür, kalınlık, besleme, devir, paso |
| `templates` / `template_versions` | Şablon ve sürümleri | şirket, parametreler, geometri JSON'u |
| `projects` | Proje | şirket, ad, durum, revizyon no, proje JSON'u (`jsonb`) |
| `project_commands` | Komut geçmişi | proje, revizyon, komut, yapan (kullanıcı / AI) |
| `exports` | Üretilen dosyalar | proje revizyonu, profil sürümü, post sürümü, dosya yolu, hash, doğrulama durumu |
| `validations` | Doğrulama kayıtları | profil sürümü, takım seti, aşama, ölçüm formu, onaylayan |
| `offcuts` | Artık parça stoğu | şirket, malzeme, kalınlık, ölçü, damar, kaynak proje, durum |
| `chat_messages` | Proje sohbet geçmişi | proje, rol, içerik, önerilen komutlar |
| `ai_usage` | Kota sayacı | şirket, ay, kullanım |

Makine profili düzenlenince yeni sürüm satırı açılır; eski sürüm değişmez. Export ve doğrulama kayıtları her zaman belirli bir sürüme bağlanır.

### 9.2 Proje JSON'u (özet)

```json
{
  "schemaVersion": 2,
  "machine": { "machineId": "…", "profileVersion": 3 },
  "stock": {
    "material": "mdf", "thickness": 18,
    "sheet": { "width": 2800, "height": 2100, "grain": 0 },
    "useOffcuts": true
  },
  "parts": [{
    "id": "p1", "name": "Kapak", "qty": 4, "grain": { "mode": "fixed", "angle": 0 },
    "kind": "rect", "params": { "w": 396, "h": 716, "r": 0 },
    "outline": [{ "x": 0, "y": 0, "bulge": 0 }],
    "inners": [],
    "holes": [{ "type": "pocket", "d": 35, "cx": 22.5, "cy": 100, "depth": 12.5, "tool": 2 }],
    "edgeBand": { "top": 1, "right": 1, "bottom": 0, "left": 1 },
    "templates": [{ "templateId": "…", "version": 2, "params": {}, "overrides": [] }]
  }],
  "nesting": { "mode": "minWaste", "gap": 8, "margin": 10 },
  "layout": { "sheets": [{ "placements": [{ "partId": "p1", "index": 0, "x": 10, "y": 10, "rot": 0, "locked": false }] }] },
  "cutting": { "tabs": { "auto": true }, "leadIn": "arc", "direction": "climb" }
}
```

- **Damar (şema v2, v3):** `stock.sheet.grain` derece (0–180) veya `null`; parça `grain.mode` serbest/sabit, `grain.angle` parçanın kendi çerçevesinde derece; yerleşim `rot` her açı (derece). v1 projeleri göçle açılır: `grainLock: true` → sabit, açı = plaka damarı.
- Parametrik parçada `params` kaynaktır, `outline` ondan türetilir. Serbest şekilde `outline` kaynaktır.
- `layout` türetilmiş veridir ama saklanır; kullanıcı elle kilitlediği yerleşimi kaybetmez.
- Takım yolu ve G-code projede saklanmaz; her seferinde yeniden üretilir. Export edilen dosya ayrıca `exports` tablosunda durur.
- Şablon projeye kopyalanır; `version` ve `overrides` güncelleme akışındaki çakışma uyarısını besler.

## 10. Repo ve Claude Code düzeni

Geliştirme Claude Code ile yapılır; bu doküman repoda `docs/SPEC.md` olarak durur ve tek referanstır. Aşağıdaki dosya yolları ve ayar adları kurulum sırasında [Claude Code dokümanından](https://docs.claude.com/en/docs/claude-code/overview) doğrulanır.

### 10.1 Repo yapısı

```text
nittcam/
  CLAUDE.md                 kısa kurallar ve komutlar
  docs/
    SPEC.md                 bu doküman
    BACKLOG.md              görevler (T001…)
    DECISIONS.md            mimari karar kayıtları
    machines/               sahadan toplanan makine bilgisi, örnek NC dosyaları
  apps/
    web/                    Next.js: arayüz + route handler'lar
  packages/
    core/
      schema/               proje JSON şeması, göç fonksiyonları
      commands/             komut katmanı
      validate/             kural doğrulama
      geometry/             yaylı çoklu çizgi, offset, fillet, dogbone
      nesting/              yerleştirici, modlar, artık parça
      toolpath/             işlemler, sıralama, tab, lead-in
      post/                 üretici + post ayar şeması
      gcode-reader/         geri okuyucu ve kontroller
      dxf/                  okuma ve yazma
    machines/               post ayarları, makine kütüphanesi, golden dosyalar
    db/                     Drizzle şeması ve göçler
    ui/                     ortak bileşenler
  e2e/                      Playwright testleri
  .claude/
    skills/                 proje skill'leri (10.3)
    agents/                 subagent tanımları (10.4)
    settings.json           izinler
  .github/workflows/ci.yml
```

Bağımlılık yönü tek taraflıdır: `apps/web` → `packages/*`; `packages/core` hiçbir uygulama paketine bağlanmaz.

### 10.2 CLAUDE.md içeriği

Kısa tutulur (bir ekranı geçmez); ayrıntı skill'lerdedir.

- Spec yolu: `docs/SPEC.md`. Çelişki varsa spec kazanır; spec eksikse soru sorulur, varsayılmaz.
- Komutlar: `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm e2e`.
- Görev akışı: backlog'dan bir görev al → branch aç → uygula → test agent'ını çağır → PR aç. Merge'i insan yapar.
- Değişmez kurallar: AI çekirdeğe giremez; `packages/core` saftır; golden G-code dosyaları insan onayı olmadan değiştirilmez; `main`'e doğrudan push yok.
- Dil: kod ve commit İngilizce tanımlayıcılarla, arayüz metni Türkçe ve çeviri dosyasında.
- İnsan kapıları: makine testi, kapsam kararı, fiyat kararı, golden dosya değişikliği, PR merge.

### 10.3 Proje skill'leri

Her skill `.claude/skills/<ad>/SKILL.md` dosyasıdır ve ilgili işte otomatik yüklenir. M0'da yazılırlar.

| Skill | Ne zaman devreye girer | İçeriği |
| --- | --- | --- |
| `task-workflow` | Her görevde | Backlog görev biçimi, branch ve commit adları, PR şablonu, "bitti" tanımı |
| `command-layer` | Yeni komut eklerken | Şema + uygulama + geri alma + doğrulama + test + AI araç tanımı adımları |
| `geometry-kernel` | Geometri koduna dokunurken | mm, bulge temsili, kontur yönü, epsilon, offset kuralları, özellik tabanlı test kalıpları |
| `nesting-engine` | Nesting'e dokunurken | Değişmezler (çakışma yok, plaka içinde, damar kuralı), deterministiklik, kıyas veri setleri |
| `gcode-safety` | Takım yolu, post veya okuyucuya dokunurken | Bölüm 7.2'deki 10 kural, golden dosya süreci, geri okuyucunun üreticiden bağımsız kalması |
| `post-processor` | Controller eklerken veya post ayarı değiştirirken | Ayar şeması, sürümleme, yeni controller kontrol listesi, sahadan gelen örnek dosyayla karşılaştırma |
| `dxf-io` | DXF okuma/yazma | Desteklenen varlıklar, birim, birleştirme toleransı, katman eşleme, test dosyaları |
| `ui-conventions` | Arayüz işlerinde | Tasarım belirteçleri, Türkçe metin kuralları, basit mod, "hareketi azalt", erişilebilirlik |
| `db-multitenancy` | Veritabanı ve API işlerinde | `company_id` kuralı, rol kontrolü, göç yazma, revizyon kilidi |
| `ai-chat` | M11'de | Araç tanımları, onay akışı, kota, yüklenen içeriğin talimat sayılmaması |

Hazır skill'lerden `frontend-design` (arayüz kalitesi) ve `skill-creator` (skill yazıp ölçmek) kullanılabilir.

### 10.4 Subagent'lar

| Agent | Görev | Sınır |
| --- | --- | --- |
| `dev` | Görevi uygular, birim testini yazar | Golden dosyayı ve CI ayarını değiştirmez |
| `tester` | Test yazar, çalıştırır, raporlar | Üretim kodunu değiştirmez; yalnızca test dosyalarına yazar |
| `safety-reviewer` | `toolpath`, `post`, `gcode-reader` değişikliklerini bölüm 7.2'ye göre inceler | Yalnızca okur ve rapor yazar |

- Ana oturum `dev` bitince `tester`'ı çağırır; otomatik tetiklenmez, talimat CLAUDE.md'de yazılıdır.
- Hata varsa `dev`'e döner; deneme sayısı 3 ile sınırlıdır, sonra insana sorulur.
- Agent'lar sıralı çalışır (kullanım limiti için paralel değil).
- **Paket (batch) çalışma (v3):** PO dev'e 2–4 küçük görevlik bir paket verir; paket tek branch ve tek PR'dır, her görevden sonra commit + push + PR açıklamasına kısa kontrol noktası yazılır. Bağlam büyürse agent görev sınırında durur ve kontrol noktasıyla PO'ya döner; PO yeni agent başlatır.

### 10.5 Git ve CI

- Her görev paketi (batch) için ayrı branch ve PR: `feat/B07-cutlist-grid` (v3); tek görevlik işler `feat/T012-nesting-modes`, `fix/T020-offset-bug`.
- Commit: Conventional Commits + görev numarası, ör. `feat(nesting): add grain rule (T012)`.
- `main` için branch protection; PR açılır, merge'i geliştirici yapar.
- GitHub Actions her PR'da: lint, typecheck, birim testleri, golden karşılaştırma, lisans denetimi, Playwright.
- Golden dosya değişen PR'a otomatik "insan onayı gerekli" etiketi düşer.

### 10.6 İzinler ve kullanım

- Agent'a izinli: `pnpm` komutları, test ve lint, görev branch'inde `git add/commit/push`, `gh pr create`.
- Yasak: `main`'e push, zorla push, sır dosyalarını okuma, repo dışı silme, canlı veritabanına bağlanma.
- Claude Code Pro plan ile başlanır; limit sık dolarsa Max'e geçilir. `ANTHROPIC_API_KEY` ortam değişkeni tanımlıysa abonelik yerine o anahtar kullanılır; kurulumda kimlik doğrulama kontrol edilir.
- Sprint'ler küçük görevlerle yürür; her sprint sonunda gözden geçirme yapılır.

## 11. Test stratejisi

Yanlış G-code fiziksel hasar demektir; bu yüzden çekirdek paket testle birlikte yazılır ve testsiz görev "bitti" sayılmaz.

| Katman | Araç | Neyi kanıtlar |
| --- | --- | --- |
| Birim | Vitest | Her komut, kural, geometri fonksiyonu beklenen sonucu verir |
| Özellik tabanlı | fast-check | Rastgele girdide değişmezler bozulmaz |
| Golden dosya | Vitest + repodaki referans NC dosyaları | Post çıktısı bayt bayt aynı kalır; değişiklik insan onayı ister |
| Geri okuma | Kendi okuyucumuz | Üretilen her G-code okunur, takım yolu modeliyle tolerans içinde eşleşir |
| Güvenlik senaryoları | Vitest | Bilerek bozulmuş G-code (malzemede rapid, sınır aşımı, spindle kapalı kesim) yakalanır |
| Çok şirketli yapı | Vitest + test veritabanı | Bir şirket diğerinin verisini okuyamaz |
| Uçtan uca | Playwright | Kesim listesi → dizilim → simülasyon → export akışı çalışır |
| Görsel (v3) | Playwright ekran görüntüsü | Her ekran 1440 ve 390 px'te, açık ve koyu temada; temel görüntüler CI'da (Linux) |
| Erişilebilirlik (v3) | @axe-core/playwright | Ciddi ve kritik ihlal yok; klavyeyle tam akış |
| Performans (v3) | Playwright trace, bundle raporu | 3D: 300 parça ≥ 45 fps; kesim listesi 1 000 satır akıcı; ilk JS bütçesi |
| Saha | Gerçek makine (insan) | Air cut ve test kesimi; sonuç `docs/machines/` altına kaydedilir |

Özellik tabanlı testlerin denetlediği değişmezler:

- **Nesting:** parçalar çakışmaz; hepsi plaka ve kenar payı içindedir; boşluk kuralı sağlanır; sabit damarlı parçanın etkin damar açısı plaka damarına eşittir (mod 180°); aynı girdi aynı sonucu verir.
- **Offset:** offset edilen yolun her noktası orijinal kontura takım yarıçapı kadar uzaktadır (tolerans içinde); yön korunur; kapalı kontur kapalı kalır.
- **Takım yolu:** delik ve cepler dış konturdan önce gelir; hiçbir kesim hareketi hedef derinliğin altına inmez; tab'lar kontur üzerindedir.
- **G-code:** bölüm 7.2'deki kuralların her biri için ayrı test vardır.
- **Komutlar:** her komut geri alındığında proje bayt bayt eski hâline döner.

Sahadan gelen her hata önce onu yeniden üreten bir test olarak yazılır, sonra düzeltilir.

## 12. Milestone planı ve ilk gün

Tüm özellikler ilk sürümdedir. v3 kararıyla saha testi ürün ~%90 bittiğinde (M9 sonu) yapılır; hesap/çok şirket ve AI sahadan sonra gelir. Her milestone çalışan, gösterilebilir bir ürün bırakır. Ayrıntılı görevler `docs/BACKLOG.md`'dedir.

### 12.1 Milestone'lar

| Milestone | İçerik | Çıkış ölçütü |
| --- | --- | --- |
| M0 — Temel | Monorepo, CI, CLAUDE.md, skill'ler, agent'lar, proje şeması, komut katmanı iskeleti, offset kütüphanesi denemesi, ayrıntılı M1 backlog'u | CI yeşil; offset kararı `DECISIONS.md`'de |
| M1 — İnce dilim | Makine profili formu, kesim listesi tablosu ve yapıştırma, dikdörtgen parça, en az fire nesting, dış kontur takım yolu (çok paso, tab, lead-in), genel post ayarı, G-code geri okuyucu, 2D simülasyon, NC export, air cut test programı. Tek kullanıcı, basit proje kaydı | Tarayıcıdan indirilen dosya tüm otomatik kontrolleri geçer |
| M2 — Tasarım sistemi ve kabuk | Belirteçler, açık/koyu tema, bileşenler, uygulama kabuğu, komut paleti, bildirimler; mevcut tüm ekranların yeniden tasarımı; görsel ve erişilebilirlik testleri | Mevcut her ekran yeni tasarımda; görsel + axe CI'da |
| M3 — Kesim listesi ve damar | Serbest açılı damar (şema v2, kadran, motor), satır içi düzenleme, toplu düzenleme, CSV/XLSX, malzeme kütüphanesi, parametrik dolap kutusu | Serbest açılı damar kesim listesinden G-code'a kadar uyulur |
| M4 — Çizim tahtası I | Editör tuvali, yakalama, dikdörtgen/daire/çizgi/yay araçları, özellikler paneli, köşe yuvarlama, iç köşe kuralı, dogbone, ölçü etiketleri, iç kontur, kesim listesi eşlemesi | Çizilen serbest parça kontrolleri geçen G-code üretir |
| M5 — Çizim tahtası II | Delik nesnesi, delme/cep/kanal/iç kontur/çizgi üzerinden takım yolları, ince tabaka, DXF içe aktarma ve katman eşleme, şablonlar ve hazır kütüphane | Şablonla menteşeli kapak ve DXF tabela işi kontrolleri geçen G-code üretir |
| M6 — 3D önizleme | 360° 3D, plakayı taşıma, kalınlık, delik/cep, doku ve damar, takım yolu, kesim oynatma, parça ayırma, montaj görünümü, basit mod | 300 parçada performans bütçesi; WebGL yoksa 2D |
| M7 — Dizilim yükseltmeleri | 3 dizilim modu, seçenekler ve iptal, çoklu stok ölçüsü, gerçek şekil nesting (döndürme, parça içinde parça), artık parça stoğu, kenar bandı düşme, yerleşim düzenleme | Üç mod, gerçek şekil ve artık parça çalışır |
| M8 — Export ve proje yönetimi | PDF (dizilim, parça listesi, fire raporu), etiket, DXF export, tüm export kayıtları, Projeler (arama, kopyalama, durum), Ana sayfa verisi, bakım kaydı, Ayarlar | NC, DXF, PDF ve etiket sunucudan üretilir |
| M9 — Cila ve saha hazırlığı | İlk kullanım, erişilebilirlik, performans, hata dayanıklılığı, duyarlı tasarım, yeni işlemler için golden ve güvenlik testleri, regresyon senaryoları, saha kiti | **~%90 çizgisi:** sahip onayıyla saha testine hazır |
| Saha 1 (insan) | Makine bilgisi, post uyarlama, air cut, fire plakada test kesimi: dış kontur, delik, cep, kanal, yay, açılı damarlı parça | İki makinede test kesimi tolerans içinde; "NittCam test etti" kaydı |
| M10 — Hesap ve çok şirket | Giriş ekranı ve animasyon, şirket, roller, kullanıcılar, RLS, barındırma kararı | İki rolle uçtan uca akış; şirketler arası yalıtım testi geçer |
| M11 — AI sohbet | Sohbet paneli, komut önerisi ve onay, uyarı rozeti, şablon güncelleme sorusu, dağınık sipariş okuma, kota (Q001) | AI hiçbir değişikliği onaysız uygulayamaz (testle) |
| M12 — Pilot | 5–10 pilot atölye, kurucu üye fiyatı, fiyat testi, geri bildirim | En az 3 atölye gerçek iş kesti |
| M13 — Ticari | Abonelik ve ödeme, kullanım şartları, şirket yapısı, KVKK, doğrulanmış profil kütüphanesi | İlk ücretli müşteri |
| M14 — Büyüme | İkinci controller ailesi, İngilizce arayüz ve global satış, teklif/maliyet, QR etiket, stok | — |

**Eski (v2) milestone adlarının karşılığı:** v2 M2 Hesap → M10 (ekranlar M2/M8'de); v2 M3 Editör → M4 + M5; v2 Saha 2 → Saha 1'e katıldı; v2 M4 Şablon ve dizilim → M5 (şablon) + M7 (dizilim); v2 M5 AI → M11; v2 M6 Animasyon ve 3D → M6 (3D), giriş animasyonu M10; v2 M7–M9 → M12–M14. Eski kararlardaki milestone adları bu tabloya göre okunur.

Süre tahmini bilinçli olarak verilmedi: haftalık ayrılan saat ve iki makinenin controller'ı belli olunca M0 sonunda eklenir.

### 12.2 M0 ve M1 görev taslağı

M0 ve M1 tamamlandı. M2 ve sonrasının görevleri (T100+), paketleri ve kabul ölçütleri `docs/BACKLOG.md`'dedir.

M0:

- [ ] T001 Monorepo iskeleti: pnpm workspace, TypeScript strict, lint, Vitest, Next.js uygulaması
- [ ] T002 GitHub Actions CI ve branch protection; lisans denetimi
- [ ] T003 CLAUDE.md, `.claude/skills` (10 skill), `.claude/agents` (3 agent), izin ayarları
- [ ] T004 Proje JSON şeması v1 (Zod) ve örnek projeler
- [ ] T005 Komut katmanı iskeleti: uygula, geri al, yinele, kayıt; ilk 5 komut
- [ ] T006 Geometri çekirdeği: yaylı çoklu çizgi tipi, alan, yön, sınırlayıcı kutu, uzunluk
- [ ] T007 Offset denemesi: CavalierContours WASM ve Clipper2 karşılaştırması, karar kaydı
- [ ] T008 Docker Compose (PostgreSQL, MinIO), Drizzle şeması ilk tablolar
- [ ] T009 M1 için ayrıntılı backlog: görev, kabul ölçütü, bağımlılık

M1:

- [ ] T010 Makine ve takım profili şeması + form (Z sıfır ve orijin dahil)
- [ ] T011 Kesim listesi tablosu ve Excel/CSV yapıştırma
- [ ] T012 Dikdörtgen yerleştirici: en az fire modu, boşluk, kenar payı, çoklu plaka
- [ ] T013 Dizilim görünümü (2D Canvas)
- [ ] T014 Takım yolu modeli; dış kontur, çok paso, lead-in/out
- [ ] T015 Tab ve küçük parça otomatik tab
- [ ] T016 Kesim sırası ve rapid sıralama
- [ ] T017 Post ayar şeması ve üretici; "genel düz G-code" ayarı; ilk golden dosyalar
- [ ] T018 G-code geri okuyucu (G0/G1/G2/G3, M kodları, modal durum)
- [ ] T019 Otomatik kontroller ve güvenlik senaryosu testleri
- [ ] T020 Simülasyon ekranı: oynatma, satır vurgusu, özet
- [ ] T021 NC export, dosya başlığı, doğrulanmamış profil uyarısı
- [ ] T022 Air cut test programı ve test parçası üretimi
- [ ] T023 Basit proje kaydı ve sihirbaz iskeleti (tek kullanıcı)
- [ ] T024 Playwright uçtan uca akış testi

### 12.3 Makine bilgi toplama listesi (sana düşen iş)

İki test makinesi için aşağıdakiler saha testinden (M9 sonu) önce toplanmalı; en değerlisi ilk maddedir.

- [ ] Makinede bugün sorunsuz çalışan 2–3 NC dosyası (USB'den kopyala). Post ayarını bunlara bakarak yazarız.
- [ ] Controller ekranının ve etiketinin fotoğrafı: marka, model, yazılım sürümü
- [ ] USB'den okunan dosya uzantısı ve dosya adı sınırı
- [ ] Takım değiştirme: otomatik mi, elle mi; kaç takım
- [ ] Z sıfırlama nasıl yapılıyor: tablaya mı, malzeme üstüne mi; takım boyu ölçer var mı
- [ ] Program sıfırı hangi köşe; tabla ölçüsü ve eksen hareket sınırları
- [ ] Tabla tutma tipi: vakum, mengene, T-slot
- [ ] Spindle max devir; devir programdan mı ayarlanıyor, elle mi
- [ ] Şu an hangi CAM yazılımı ve hangi post processor kullanılıyor
- [ ] Kullanılan takımlar: çap, tip, ağız sayısı; MDF ve melaminde kullanılan besleme ve devir

Bunlar `docs/machines/<makine-adı>/` altına konur.

### 12.4 Yarın nasıl başlanır

1. GitHub'da private `nittcam` reposu aç, yerelde klonla.
2. Bu dokümanı Markdown olarak indir, `docs/SPEC.md` adıyla repoya koy.
3. Repo klasöründe Claude Code'u başlat ve şu talimatı ver:

```text
docs/SPEC.md dosyasını baştan sona oku. Bölüm 12.2'deki M0 görevlerini
docs/BACKLOG.md dosyasına kabul ölçütleriyle yaz ve bana onaylat.
Onaydan sonra T001'den başla. Her görev ayrı branch ve PR olsun.
Spec'te eksik veya çelişkili bir şey görürsen varsayma, sor.
```

Claude Code önceki konuşmaları hatırlamaz; bildiği her şey bu dokümandan ve repodan gelir. Bu yüzden alınan her yeni karar `docs/DECISIONS.md`'ye veya bu spec'e işlenir.

## 13. İş modeli, rekabet, marka ve hukuk

### 13.1 Model ve paketler

Aylık abonelik; dosya başına ücret yok. Dosya başına ücret denemekten caydırır, çünkü plan birkaç kez yeniden üretilir.

Paket taslağı (test edilecek varsayım):

| Paket | İçerik | Başlangıç varsayımı |
| --- | --- | --- |
| Başlangıç | Nesting, çizim, DXF/PDF, fire raporu | ₺750–1.250 / ay |
| Pro | + G-code export, makine profilleri (1–2 makine), proje geçmişi | ₺1.500–2.500 / ay |
| Şirket | Çoklu makine/kullanıcı, öncelikli destek, kurulum | Teklif usulü |

- **AI kararı (açık):** geliştiricinin fikri AI'lı paketi bir kademe pahalı yapmak. Önerilen alternatif: AI her pakette aylık kotayla, fazlası ek paket.
- Makine / post processor kurulum ücreti ayrıca alınabilir.
- İlk 10–20 küçük müşteriye "kurucu üye" fiyatı, 12 ay sabit.
- Büyük firmalar: makine ve kullanıcı sayısıyla ölçeklenen teklif; ilk 1–2 büyük müşteri için süreli pilot.
- Yıllık ödemede indirim. TL fiyatı 6 ayda bir güncellenir veya USD'ye endekslenir.

### 13.2 Fiyatlama mantığı ve gelir

- Değer = (aylık plaka sayısı × fire tasarrufu × plaka bedeli) + operatör zamanı. Abonelik bunun küçük bir kısmı olmalı.
- Pilot atölyelerde gerçek plaka sayısı ve fiyatı sorulur; 5–10 atölyeyle "ne kadar olursa ucuz, ne kadar pahalı" görüşmesi yapılır.
- 10 atölye × ₺2.000 = ₺20.000/ay (≈ 425 dolar, kur ≈ 47). Tek başına yetersiz.

Kaldıraçlar: müşteri sayısı (kanal: makine satıcıları ve servisleri, içerik, ücretsiz fire hesaplayıcı); global pazar (İngilizce arayüz, USD/EUR fiyat); makine ve kullanıcı başına fiyat; ek modüller (teklif/maliyet, QR etiket, stok); yıllık ödeme.

Yan projeden ana gelire geçişten önce izlenecekler: aktif ödeyen atölye sayısı ve aylık yenileme oranı, doğrulanmış profil sayısı, aylık üretilen dosya sayısı, ölçülen fire tasarrufu, müşteri başına destek süresi.

### 13.3 Rekabet

Rakipler: Vectric (VCarve/Aspire), Cabinet Vision, Mozaik, Polyboard, Alphacam, SolidCAM, ücretsiz kesim optimizasyon siteleri, makine üreticilerinin kendi yazılımları. Yerel rakipler araştırılacak.

Fiyat referansları (Ekim 2026, yaklaşık, kur ≈ 47 TL):

| Ürün | Fiyat | TL karşılığı |
| --- | --- | --- |
| VCarve Pro | ≈ 699 $ kalıcı lisans | ≈ 33 bin TL |
| Aspire | ≈ 1.995 $ | ≈ 94 bin TL |
| Alphacam | 15–20 bin $ (duyum, doğrulanmadı) | ≈ 700–940 bin TL |

₺2.500/ay yılda 30 bin TL eder; küçük atölye için VCarve Pro'nun tek seferlik fiyatına bir yılda yaklaşır. Küçük atölyenin kıyas noktası VCarve, büyük firmanınki Alphacam sınıfı paketlerdir.

- **Fark noktaları:** kurulumsuz web, Türkçe destek, nesting ve fire odağı, makine profili ve şablon kütüphanesi, öğrenme gerektirmemesi.
- **Kalıcı avantaj:** controller ailesi bazında doğrulanmış post ve profil kütüphanesi; atölyelerin biriktirdiği şablonlar (geçiş maliyeti); gerçek üretim verisi (gerçek ve tahmini süre, malzemeye göre besleme/devir).
- Vectric'in levha yerleşim özellikleriyle karşılaştırma yapılacak.

### 13.4 Marka ve alan adı

- **Ad:** NittCam. "Cam" sektörde açıklayıcıdır; ayırt edicilik "Nitt" üzerindedir. İngilizce aramalarda kamera ürünleriyle karışabilir.
- **Alan adı (karar bekliyor):** geliştiricinin planı `nitt.cam` ana adres. Öneri: birincil web ve e-posta `nittcam.com`, `nitt.cam` kısa adres. `.cam` uzantısı e-posta filtrelerinde daha çok incelenir; ürün e-postaları `nittcam.com`'dan gitsin, SPF/DKIM/DMARC kurulsun. `.cam` yenileme fiyatı kontrol edilsin. Opsiyonel: `nittcam.com.tr`.
- **Tescil:** TÜRKPATENT'te "nittcam" bulunamadı. Benzerler: nitt studio, sin nitt, nitto; sınıfları ve sahipleri kontrol edilecek (özellikle 9, 42, 35). Önceki marka çatışmaları kendiliğinden değil, yayımdan sonra iki ay içinde itiraz üzerine incelenir. Başvurudan önce marka vekilinden sınıf bazlı benzerlik analizi alınacak.
- **Başvuru:** önce kelime markası. Sınıf 42 (SaaS) ana sınıf, 9 opsiyonel, 35 ilk aşamada gerekmeyebilir. Ücret yaklaşık ₺2.000–2.800 (KDV/harç ayrı); resmî tarifeden doğrulanacak.
- **Sosyal:** Instagram'da nittcam yok. Diğer platformlar ve GitHub organizasyon adı rezerve edilecek.
- **Logo:** Canva şablonuyla yapılan logo tescil edilemez. İlk aşamada özgün yazı logosu (Figma veya Inkscape, ücretsiz font).

### 13.5 Hukuk ve ön kontroller

Başlamadan önce:

- [ ] Alan adı ve marka sorgusu
- [ ] İş sözleşmesindeki fikrî mülkiyet, rekabet yasağı ve yan faaliyet maddeleri

İlk ücretli müşteriden önce:

- [ ] Marka başvurusu
- [ ] Şirket yapısı (şahıs / limited), vergi, e-fatura / e-arşiv; avukat ve mali müşavir görüşü; sigorta
- [ ] Kullanım şartları: sorumluluk sınırı, "ilk çalıştırmada air cut zorunlu", dosya sahipliği (müşterinin projeleri müşterinindir)
- [ ] KVKK: aydınlatma metni, gizlilik politikası, çerez bildirimi, yurt dışı sunucu aktarımı, VERBİS eşikleri
- [ ] Mesafeli satış sözleşmesi, ön bilgilendirme, iptal/iade
- [ ] Ödeme altyapısı: yerli sanal pos; global satış için merchant-of-record; uygunluk ve komisyon doğrulanacak
- [ ] AI sağlayıcı koşulları ve veri işleme
- [ ] Açık kaynak lisans denetimi
- [ ] Üçüncü taraf markalar: "uyumlu" denebilir, logo kullanılmaz
- [ ] Güvenlik: 2FA, private repo, yedekleme

## 14. Riskler, açık maddeler ve sonraki sürümler

### 14.1 Riskler

| Risk | Etki | Önlem |
| --- | --- | --- |
| Yanlış G-code | Takım kırılması, malzeme ve makine hasarı. En kritik risk. | Bölüm 7.2 kuralları, geri okuyucu, golden dosyalar, air cut zorunluluğu, sahaya erken çıkış |
| Controller çeşitliliği | Her makine + controller + ayar farklı davranır | Bildirimsel post ayarı; tek aile ile başlama; sahadan örnek dosya |
| Eski controller kısıtları | Dosya adı, boyut, yay desteği, satır numarası | Profilde kısıt alanları; yay yoksa çizgiye bölme; dosya bölme |
| Geometri hataları | Offset, iç köşe, kesim sırası yanlış çıkar | Özellik tabanlı testler; offset kütüphanesi denemesi |
| Offset kütüphanesi uymaz | M0 uzar | Yedek plan Clipper2 + yay uydurma; karar M0'da |
| Kapsam büyüklüğü | Geri bildirim ve gelir gecikir | Her milestone gösterilebilir ürün bırakır; M1 sonunda saha |
| Çizim editörü | Projenin en büyük iş kalemi | M4–M5'e bölündü; genel kısıt çözücü yok; basit kurallar |
| Geç saha testi (v3) | Yanlış G-code varsayımı geç fark edilir; çok kod etkilenir | Sahibin kararı. Bölüm 7.2 kuralları, geri okuyucu, golden dosyalar ve M9'daki regresyon seti; post bildirimsel olduğu için uyarlama çoğunlukla ayar değişikliğidir |
| 3D performansı (v3) | Eski atölye bilgisayarında yavaşlık | Tembel yükleme, basit mod, 2D'ye düşüş, performans bütçesi testleri |
| DXF çeşitliliği | Gerçek dosyalar kirli gelir | Sınırlı varlık listesi, önizleme ve rapor, gerçek müşteri dosyalarıyla test |
| AI hataları | Yanlış ölçü veya parça | Komut onayı, kodla doğrulama, AI'ın export'a erişememesi |
| Satış ve güven | Atölyeler yeni yazılıma yavaş güvenir; yerinde destek isteyebilir | Pilot, kurucu üye fiyatı, makine satıcısı kanalı |
| Düşük ödeme gücü | Küçük atölye geliri sınırlı | Makine başına fiyat, büyük müşteri, global pazar |
| Sorumluluk | Fiziksel üretim hukuki risk taşır | Kullanım şartları, sigorta, etiket dili |
| E-posta teslim edilebilirliği | `.cam` uzantısı filtreye takılabilir | `nittcam.com` birincil |
| Tek kişi | Destek ve satış yükü | Kurulum ücreti, şablon ve profil kütüphanesiyle destek ihtiyacını azaltma |

### 14.2 Açık maddeler

Makine (bölüm 12.3'teki listeyle kapanır):

- [ ] İki test makinesinin controller markası ve modeli
- [ ] Dosya uzantısı, takım değiştirme tipi, tabla tutma tipi, Z sıfırlama yöntemi
- [ ] Eski controller kısıtları (dosya adı, boyut, yay, satır numarası, delik döngüsü)

Teknik (M0–M2'de kapanır; kimlik ve barındırma M10'da):

- [ ] Offset kütüphanesi kararı
- [ ] DXF ve PDF kütüphanelerinin lisans ve bakım doğrulaması
- [ ] Kimlik kütüphanesi ve barındırma kararı
- [ ] Haftalık ayrılacak geliştirme saati ve süre tahmini

Ürün ve iş:

- [ ] Paket içerikleri ve fiyatlar; AI'ın paketlerdeki yeri
- [ ] Hazır şablonların (menteşe, kulp, ray) üretici ölçüleri
- [ ] İlk pilot atölyeler
- [ ] Vectric nesting özellikleriyle karşılaştırma; yerel rakip araştırması
- [ ] Gelir hedefi ve yan projeden ana gelire geçiş ölçütleri

Marka ve hukuk:

- [ ] Alan adı kararı: `nitt.cam` mı `nittcam.com` mu birincil
- [ ] Nitt Studio, Sin Nitt, Nitto sınıf ve sahip kontrolü; marka vekili görüşü
- [ ] Hukuki yapı (kullanım şartları, şirket, sigorta, KVKK)
- [ ] İş sözleşmesi kontrolü (yan proje)

### 14.3 Sonraki sürümler

- Serbest şekilli cep, V-oyma, yazı aracı
- DWG içe aktarma, DXF'te yazı ve blok içi blok
- Kural tabanlı akıllı şablonlar (ör. kapak yüksekliğine göre menteşe adedi)
- Mermer/taş malzeme desteği
- Maliyet hesabı (parça, plaka, işçilik, CNC süresi, takım, fire), teklif
- QR/barkod etiket, stok, sipariş yönetimi, üretim analitiği, ERP entegrasyonu
- Malzeme kaldırma (voxel) 3D simülasyonu
- Offline masaüstü uygulaması (Tauri)
- Kendi formatı olan makineler için doğrudan dosya üretimi
