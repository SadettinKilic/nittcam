# NittCam — Proje Dokümanı v2

Nov 16, 2026 · @Sadettin

## 1. Özet

NittCam, CNC router kullanan atölyeler için web tabanlı CAM ve üretim planlama yazılımıdır. Girdi kesim listesi, çizim, DXF veya AI sohbettir; çıktı plaka dizilimi, takım yolu ve makine profiline uygun G-code, DXF ve PDF'tir.

- **Durum:** fikir / ön geliştirme. Yan proje, tek geliştirici, Claude Code ile AI destekli kodlama.
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
| Fason CNC kesim işletmeleri | DXF içe aktarma, katmana göre işlem atama, nesting, G-code | Parçalar sınırlayıcı kutusuyla dizilir, gerçek şekil nesting sonraya |
| Reklam / tabela üreticileri | DXF'ten harf ve şekil kontur kesimi | V-oyma, yazı aracı ve serbest şekilli cep yok; yazı DXF'te eğriye çevrilmiş gelmeli |

Başlangıç makine segmenti: düz G-code kullanan routerlar (Mach3, Syntec, NcStudio gibi controller'lar). Kendi program formatı olan makineler (Biesse CIX, Homag woodWOP MPR, SCM Xilog) kapsam dışıdır; bu müşterilere DXF/PDF export ile hizmet verilir.

### 2.3 İlk sürüm kapsamı

- Giriş ekranı, üyelik, şirket, roller (Yönetici / Operatör)
- Menü: Ana sayfa, Makineler, Projeler, Şablonlar, Oluştur, Ayarlar
- Makine yönetimi, makine ve takım profili, manuel bakım takibi
- Oluştur sihirbazı: makine, malzeme, kalınlık, plaka ölçüsü, damar yönü
- Kesim listesi tablosu ve Excel/CSV yapıştırma
- 2D çizim editörü: parametrik parçalar, serbest şekiller, özellikler paneli, köşe yuvarlama, dogbone
- Delik nesnesi (cep / geçme / kanal)
- DXF içe aktarma (bölüm 4.6'daki sınırlarla)
- Şablonlar ve şablon güncelleme akışı
- Nesting, 3 dizilim modu, damar yönü, artık parça stoğu
- Takım offset'i, tab, kesim sırası, lead-in/out, çok paso, küçük parça güvenliği
- Tek controller ailesi ve tek post processor ile başlangıç
- G-code geri okuyucu, önizleme ve simülasyon
- Test programı (air cut) ve doğrulama ekranları
- NC, DXF, PDF export; parça etiketi; proje kaydı, kopyalama, export geçmişi
- AI sohbet (komut katmanı üzerinden)
- Giriş animasyonu, 3D plaka önizleme, kamera geçişi

### 2.4 v2'de eklenen özellikler

| Özellik | Ne yapar | Milestone |
| --- | --- | --- |
| Kesim listesi yapıştırma | Excel/CSV'den ad, en, boy, adet, damar sütunlarını tabloya alır; AI gerekmez | M1 |
| Makine profilinde Z sıfır ve orijin | Z sıfırı tabla mı malzeme üstü mü, orijin hangi köşe | M1 |
| Küçük parça güvenliği | Eşik altındaki parçalara otomatik tab veya son pasoda ince tabaka bırakma | M1 (tab), M3 (ince tabaka) |
| Parça numarası ve etiket | PDF'te ve dizilim görünümünde parça numarası; etiket sayfası | M2 |
| DXF içe aktarma | Fason ve tabela işleri için hazır çizimi alma | M3 |
| Dogbone / T-bone | Geçmeli parçalarda iç köşeyi takım yarıçapı kadar taşırır | M3 |
| Artık parça stoğu | Kalan dikdörtgen plakayı kaydeder, sonraki işte önce onu kullanır | M4 |
| Kenar bandı bilgisi | Parça kenarı başına bant kalınlığı; kesim ölçüsünden düşme seçeneği | M4 |

### 2.5 Başlangıçta dışarıda

- 3D CAM, çok eksenli CNC, tam 3D simülasyon
- Mermer/taş malzeme (arayüzde "yakında")
- DWG içe aktarma; DXF'te yazı, ölçü, tarama ve blok içi blok
- V-oyma, yazı aracı, serbest şekilli cep boşaltma
- Gerçek şekil (dikdörtgen olmayan) nesting
- Birden fazla controller ailesi
- Kendi formatı olan makineler için doğrudan dosya üretimi
- Karmaşık birleştirme (joinery), kural tabanlı akıllı şablonlar, genel kısıt çözücü
- Serbest açılı damar yönü
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

- Solda hafif kırık beyaz dikey menü. Sol üstte şirket logosu, altında giriş yapan operatörün adı.
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
| Artık parçalar | Kayıtlı artık plakalar: malzeme, kalınlık, ölçü, damar, kaynak proje (M4; Projeler altında sekme) |
| Ayarlar | Şirket bilgileri, kullanıcılar ve roller, malzeme varsayılanları, abonelik ve fatura |

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
- **Damar yönü:** yalnızca ahşap ve kaplamalı malzemede görünür. Açı kadranı; hızlı butonlar 0° / 90°.
- **Malzeme = parametre seti:** her malzeme ve kalınlık için besleme, devir, paso derinliği, önerilen takım, tab ayarı varsayılanları. Şirket bunları kendi makinesine göre düzenler.

Önizleme M1'de 2D'dir. M6'da açılı, hafif hareketli 3D plaka önizlemesine dönüşür; doku kodla üretilir, "İleri" denince kamera yumuşak geçişle kuşbakışı görünüme döner. Düşük performanslı bilgisayarlar için basit mod kalır.

## 4. Parça girişi ve çizim editörü

### 4.1 Kesim listesi

Kesim listesi, parçaların tablo görünümüdür: ad, en, boy, adet, damar kilidi, kenar bandı. Excel veya CSV'den kopyalanan satırlar tabloya yapıştırılır; sütunlar otomatik eşlenir, kullanıcı onaylar. Birim (mm/cm) belirsizse sorulur. Tablodaki her satır editörde parametrik dikdörtgen parçadır.

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
- **Serbest şekil ve DXF parçaları:** sınırlayıcı dikdörtgeniyle dizilir. Gerçek şekil nesting sonraki sürümdedir.
- **Boşluklar:** takım çapı, parça arası boşluk ve plaka kenar payı hesaba katılır.
- **Damar kuralı:** damarı kilitli parça yalnızca 0°/180° döner; diğerleri 0°/90°/180°/270°. Kural motorda uygulanır, AI yalnızca alanı doldurur.
- **Çoklu plaka:** parçalar sığmazsa yeni plaka açılır; plaka sayısı raporlanır.
- **Artık parça:** aynı malzeme ve kalınlıktaki kayıtlı artıklar önce denenir. Dizilim sonunda eşik üstü (varsayılan 300×300 mm) dikdörtgen artık, kullanıcı onayıyla stoğa kaydedilir.
- **Elle müdahale:** kullanıcı bir parçayı sürükleyip kilitleyebilir; yeniden dizilim kilitli parçalara dokunmaz.

### 6.3 Takım yolu

- **Offset:** takım merkezi yolu parça sınırından takım yarıçapı kadar kaydırılır. Dış kontur dışarıdan, iç kontur ve delik içeriden. Offset yayları yay olarak korur.
- **İşlem türleri:** dış kesim, iç kesim, çizgi üzerinden, dairesel cep, halka kanal, delme.
- **Kesim sırası:** önce delik ve cep, sonra iç kontur, en son dış kontur. Küçük parçalar büyüklerden önce kesilir (vakum hâlâ güçlüyken).
- **Derinlik:** paso derinliğine göre çok paso. Geçme kesimde hedef = kalınlık + fire tabla payı.
- **Giriş/çıkış:** lead-in ve lead-out (yay veya düz). Dalma düz veya rampalı.
- **Tab:** tutucu köprüler; adet, genişlik ve yükseklik ayarlanır. Tab köşeye ve yay üstüne konmaz.
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
| 3D plaka önizleme | Three.js (react-three-fiber) | M6; doku kodla üretilir |
| Şema ve doğrulama | Zod | Komut şemaları AI araç tanımına çevrilir |
| Offset | CavalierContours (WASM) adayı; yedek Clipper2 + yay uydurma | M0'da deneme görevi ile karar |
| Nesting | Kendi MaxRects / giyotin yerleştiricimiz | Damar, artık parça ve mod kontrolü için |
| Post processor | Kendi üreticimiz + bildirimsel ayar dosyaları | Jinja2 yerine |
| G-code geri okuyucu | Kendi ayrıştırıcımız | Üreticiden bağımsız yazılır |
| DXF | Okuma için dxf-parser adayı; yazma için kendi yazıcımız | Lisans ve bakım durumu M0'da doğrulanır |
| PDF | pdf-lib + gömülü font | Türkçe karakter için font gömülür |
| Sunucu | Next.js route handler'ları | Ayrı backend servisi yok |
| Veritabanı | PostgreSQL + Drizzle ORM | Proje JSON'u `jsonb` sütununda |
| Kimlik | Better Auth (şirket ve rol desteğiyle) adayı | M2 başında doğrulanır |
| Dosya depolama | S3 uyumlu object storage | Export dosyaları |
| AI | Anthropic API, araç çağrısı (tool use), yalnızca sunucudan | M5 |
| Test | Vitest, fast-check, Playwright | Bölüm 11 |
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
- **Canlı:** barındırma kararı M2 sonunda verilir. KVKK yurt dışı aktarım kuralları kararı etkiler (bölüm 13.5); açık madde.

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
| `users` | Kullanıcı | şirket, rol (yönetici / operatör), e-posta |
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
  "schemaVersion": 1,
  "machine": { "machineId": "…", "profileVersion": 3 },
  "stock": {
    "material": "mdf", "thickness": 18,
    "sheet": { "width": 2800, "height": 2100, "grain": 0 },
    "useOffcuts": true
  },
  "parts": [{
    "id": "p1", "name": "Kapak", "qty": 4, "grainLock": true,
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
| `ai-chat` | M5'te | Araç tanımları, onay akışı, kota, yüklenen içeriğin talimat sayılmaması |

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

### 10.5 Git ve CI

- Her görev için ayrı branch: `feat/T012-nesting-modes`, `fix/T020-offset-bug`.
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
| Saha | Gerçek makine (insan) | Air cut ve test kesimi; sonuç `docs/machines/` altına kaydedilir |

Özellik tabanlı testlerin denetlediği değişmezler:

- **Nesting:** parçalar çakışmaz; hepsi plaka ve kenar payı içindedir; boşluk kuralı sağlanır; damarı kilitli parça 90° dönmez; aynı girdi aynı sonucu verir.
- **Offset:** offset edilen yolun her noktası orijinal kontura takım yarıçapı kadar uzaktadır (tolerans içinde); yön korunur; kapalı kontur kapalı kalır.
- **Takım yolu:** delik ve cepler dış konturdan önce gelir; hiçbir kesim hareketi hedef derinliğin altına inmez; tab'lar kontur üzerindedir.
- **G-code:** bölüm 7.2'deki kuralların her biri için ayrı test vardır.
- **Komutlar:** her komut geri alındığında proje bayt bayt eski hâline döner.

Sahadan gelen her hata önce onu yeniden üreten bir test olarak yazılır, sonra düzeltilir.

## 12. Milestone planı ve ilk gün

Tüm özellikler ilk sürümdedir, ama gerçek makineye M1 sonunda çıkılır. Her milestone çalışan, gösterilebilir bir ürün bırakır.

### 12.1 Milestone'lar

| Milestone | İçerik | Çıkış ölçütü |
| --- | --- | --- |
| M0 — Temel | Monorepo, CI, CLAUDE.md, skill'ler, agent'lar, proje şeması, komut katmanı iskeleti, offset kütüphanesi denemesi, ayrıntılı M1 backlog'u | CI yeşil; offset kararı `DECISIONS.md`'de |
| M1 — İnce dilim | Makine profili formu, kesim listesi tablosu ve yapıştırma, dikdörtgen parça, en az fire nesting, dış kontur takım yolu (çok paso, tab, lead-in), genel post ayarı, G-code geri okuyucu, 2D simülasyon, NC export, air cut test programı. Tek kullanıcı, basit proje kaydı | Tarayıcıdan indirilen dosya tüm otomatik kontrolleri geçer |
| Saha 1 (insan) | Makine bilgisi toplanır, post ayarı uyarlanır, air cut, sonra fire plakada test kesimi, ölçü formu | İki makinede test kesimi tolerans içinde; "NittCam test etti" kaydı |
| M2 — Hesap ve iskelet | Giriş, şirket, roller, menü, Ana sayfa, Makineler (bakım dahil), Projeler, Ayarlar, export geçmişi, doğrulama ekranları, PDF ve DXF export, parça etiketi | İki rolle uçtan uca akış; şirketler arası yalıtım testi geçer |
| M3 — Editör | Parametrik parçalar, serbest şekil, özellikler paneli, köşe yuvarlama, dogbone, iç kontur, delik nesnesi, DXF içe aktarma, katman eşleme, ince tabaka seçeneği | Çizilen ve DXF'ten gelen parça kesilebilir G-code üretir |
| Saha 2 (insan) | Delik, cep, iç kontur ve yaylı (G2/G3) parçalar gerçek makinede kesilir | Delik çapı ve cep derinliği tolerans içinde |
| M4 — Şablon ve dizilim | Şablon sistemi ve güncelleme akışı, hazır kütüphane, 3 dizilim modu, damar yönü, artık parça stoğu, kenar bandı, elle yerleşim kilidi | Menteşeli kapak projesi şablonla 2 dakikada hazırlanır |
| M5 — AI sohbet | Sohbet paneli, komut önerisi ve onay, uyarı rozeti, şablon güncelleme sorusu, dağınık sipariş okuma, kota | AI hiçbir değişikliği onaysız uygulayamaz (testle) |
| M6 — Animasyon ve 3D | Giriş animasyonu, 3D plaka önizleme, kamera geçişi, doku ve damar, basit mod | Eski bilgisayarda basit mod akıcı çalışır |
| M7 — Pilot | 5–10 pilot atölye, kurucu üye fiyatı, fiyat testi, geri bildirim | En az 3 atölye gerçek iş kesti |
| M8 — Ticari | Abonelik ve ödeme, kullanım şartları, şirket yapısı, KVKK, doğrulanmış profil kütüphanesi | İlk ücretli müşteri |
| M9 — Büyüme | İkinci controller ailesi, İngilizce arayüz ve global satış, teklif/maliyet, QR etiket, stok | — |

Süre tahmini bilinçli olarak verilmedi: haftalık ayrılan saat ve iki makinenin controller'ı belli olunca M0 sonunda eklenir.

### 12.2 M0 ve M1 görev taslağı

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

İki test makinesi için aşağıdakiler M1 bitmeden toplanmalı; en değerlisi ilk maddedir.

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
| Çizim editörü | Projenin en büyük iş kalemi | M3'e alındı; genel kısıt çözücü yok; basit kurallar |
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

Teknik (M0–M2'de kapanır):

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

- Gerçek şekil (dikdörtgen olmayan) nesting
- Serbest şekilli cep, V-oyma, yazı aracı
- DWG içe aktarma, DXF'te yazı ve blok içi blok
- Kural tabanlı akıllı şablonlar (ör. kapak yüksekliğine göre menteşe adedi)
- Serbest açılı damar yönü
- Mermer/taş malzeme desteği
- Maliyet hesabı (parça, plaka, işçilik, CNC süresi, takım, fire), teklif
- QR/barkod etiket, stok, sipariş yönetimi, üretim analitiği, ERP entegrasyonu
- Tam 3D simülasyon
- Offline masaüstü uygulaması (Tauri)
- Kendi formatı olan makineler için doğrudan dosya üretimi
