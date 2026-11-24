# Panel hatları: Osai, TPA, Biesse, SCM, Homag (kısa not)
> Durum: kısa araştırma notu, tam şablon değil. Güven: orta (TPA ve Fusion postları birincil kaynaklardan okundu; Biesse ve Homag için büyük ölçüde CAM satıcısı ve forum kaynakları kullanıldı).

## Soru
Bu makinelere NittCam'in düz G-kodu (ISO) postu yeterli mi, yoksa kendi formatları (.cix/.bpp, .xxl, .mpr, .tcn) mı gerekiyor?

## Kısa cevap
- **Homag/Weeke (woodWOP, .mpr):** düz G-kodu çalıştırılamıyor. Weeke makineleri standart G/M kodundan farklı, kendine özgü bir format kullanıyor [6]. Homag'ın CNC programlama sistemi woodWOP [7]. CAM'ler MPR yazıyor (Fusion'da genel woodWOP postu var [8], PolyBoard MPR üretiyor [9]). Fanuc G-kodunu MPR'ye çeviren bir Stiles dönüştürücüsü olduğu ikinci elden bildiriliyor [6].
- **Biesse (bSolid / BiesseWorks; .cix, .cid, .bpp):** CAM'ler .cix (bSolid) veya .cid (BiesseWorks) üretiyor; makine kodunu bu yazılımlar oluşturuyor [10]. Forumlara göre ISO yolu var ama makineden makineye çok farklı ve genelde 4/5 eksen için kullanılıyor. Biesse'nin önerisi CIX ve ISO alt program kullanmak [11] (forum, ikincil kaynak; arama özeti).
- **SCM (Xilog, .xxl; yeni Maestro):** Fusion'un SCM postu (SCM-Prisma 110) `.xxl` uzantılı, ISO olmayan Xilog komutları yazıyor (`H DX= DY= DZ=` başlığı, `XL2P` doğru, `XA2P`/`XAR2` yay, `S=` spindle, `;` yorum) [3]. Maestro'nun yerel formatı için bu araştırmada kaynak açılmadı (bilinmiyor).
- **TPA (TpaCAD, .tcn):** TpaCAD'in yerel formatı TCN [5]. TpaCAD'de **ISO içe aktarma modülü var** ama makine üreticisi açarsa çalışıyor. Modül G0/G1/G2/G3, G40/41/42, G70/G71 (inç/mm), T, S, F alanlarını profil ve delik işlemlerine çeviriyor (yalnız yüz 1). `%`, `(` veya `;` ile başlayan satırları yorum sayıyor [4]. Ayrıca "ISO eğrisi" uygulaması ile ISO dosyası bir parça programına profil olarak bağlanabiliyor (asıl kullanımı 4/5 eksen) [5]. Yani doğrudan G-kodu çalıştırma değil, TCN'ye dönüştürme.
- **Osai (10 serisi, OPEN kontrolcüler):** Osai, ahşap makinelerinde kullanılan bir İtalyan CNC üreticisi. Biesse Arrow (yaklaşık 1999) ve Holzher makinelerinde Osai 10 serisi raporlanıyor [12] (arama özeti). Osai kendi ISO dilini okuyor. Fusion'un genel OSAI postu `.nc` yazıyor, yorumlar `;` ile başlıyor, dwell `DWT=<saniye>` sonra `G4` biçiminde [2]. Bu, Fanuc/Mach3 dilinden farklı bir lehçe. Ancak Biesse/SCM gibi markalı hatlarda operatör normalde Osai ISO'su değil, üreticinin yazılımını (bSolid, Xilog) kullanıyor [3][10].

## NittCam için öneri
1. Biesse, SCM, Homag ve TPA panel hatları **G-kodu postlarının kapsamı dışında** kalmalı. Bu makineler için doğru yol format dışa aktarıcıları (exporter): ilk aday MPR (woodWOP), sonra CIX (bSolid), XXL (Xilog), TCN (TpaCAD). Her biri ayrı bir iş kalemi, şartname kararı ve gerçek makine testi ister.
2. Kısa vadede bu kullanıcılar için en ucuz köprü **DXF dışa aktarımı**: woodWOP DXF içe aktarıyor [1], TpaCAD de DXF içe aktarıyor [4]. Operatör işlemeyi kendi yazılımında atar.
3. TPA makinelerinde ISO içe aktarma açıksa NittCam'in 3 eksen G-kodu (G0/G1/G2/G3, G71, T/S/F) TpaCAD'e profil olarak alınabilir [4]. Bu yalnız "deneysel" sayılmalı; kesin destek sayılmamalı.
4. Osai kontrolcülü, markasız (OEM) router'lar için ileride ayrı bir "osai" G-kodu postu düşünülebilir (`;` yorum, `DWT=` bekleme) [2]. Bunun için önce Osai programlama kılavuzu gerekli.

## Kaynaklar
1. HOMAG, "woodWOP DXF import basic". https://www.homag.com/fileadmin/software/downloads/woodwop-dxf_import_basic.pdf (erişim 2026-11-23) [maker doc; arama özeti, belge açılamadı]
2. Autodesk, Fusion post library, `osai.cps` ("Generic milling post for OSAI", revizyon tarihi 2026-07-14). https://cam.autodesk.com/posts/posts/osai.cps (erişim 2026-11-23) [CAM vendor]
3. Autodesk, Fusion post library, `scm.cps` ("Generic post for SCM-Prisma 110", `.xxl`, revizyon tarihi 2025-02-12). https://cam.autodesk.com/posts/posts/scm.cps (erişim 2026-11-23) [CAM vendor]
4. TPA S.r.l., TpaCAD Program Editor 2.2.0 (bölüm "From ISO format to TpaCAD format"). https://cdn.shopify.com/s/files/1/0350/8119/1561/files/TpaCAD_eng.pdf (erişim 2026-11-23) [maker manual]
5. TPA S.p.A., TpaWorks Working Editor 2.1.0 (bölüm "Application of ISO curves"). https://cdn.shopify.com/s/files/1/0350/8119/1561/files/TpaWorks_eng.pdf (erişim 2026-11-23) [maker manual]
6. MecSoft, RhinoCAM 2024 yardım, "Weeke-Homag-Woodwop machines g-code output". https://mecsoftcorp.github.io/RhinoCAM-2024/weeke-homag-woodwopmachinesg-codeoutput.html (erişim 2026-11-23) [CAM vendor]
7. HOMAG, "CNC Software woodWOP" broşürü (woodWOP 9.0). https://www.homag.com/fileadmin/product/cnc/brochures/woodwop/CNC-Software-woodWOP-EN.pdf (erişim 2026-11-23) [maker brochure]
8. Autodesk, Fusion post library, woodWOP araması. https://cam.autodesk.com/hsmposts?p=woodwop (erişim 2026-11-23) [CAM vendor; arama özeti, liste JS ile yüklendiği için belge açılamadı]
9. Wood Designer, "Homag / Weeke integration (PolyBoard)". https://wooddesigner.org/homag-weeke-integration-polyboard/ (erişim 2026-11-23) [CAM vendor; arama özeti, belge açılamadı]
10. Wood Designer, "Biesse integration (PolyBoard)". https://wooddesigner.org/biesse-integration-polyboard/ (erişim 2026-11-23) [CAM vendor]
11. Autodesk HSM forum, "Biesse woodworking router using CIX format". https://forums.autodesk.com/t5/hsm-post-processor-ideas/biesse-woodworking-router-using-cix-format/idi-p/7470469 (erişim 2026-11-23) [forum, ikincil kaynak; arama özeti, belge açılamadı]
12. WOODWEB, "Biesse Arrow W OSAI 10 Control". https://woodweb.com/knowledge_base/Biesse_Arrow_W_OSAI_10_Control__762996.html (erişim 2026-11-23) [forum, ikincil kaynak; arama özeti, belge açılamadı]
