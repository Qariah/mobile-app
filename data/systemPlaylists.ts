/**
 * System Playlists - Curated playlists shipped with the app.
 * These are read-only playlists that provide themed collections of Quranic recitations.
 *
 * Qariah-curated: items carry reciterId so each tile plays a specific
 * Qariah-catalog recitation rather than falling through to the user's default.
 * Sprint 12/13/14 curation work. Sprint 14 round-3 added Al-A'raf to Surahs
 * of the Prophets; Sprint 12 D2 expanded Stories of the Prophets 6→13.
 *
 * Sprint 25 (#283) — converted to `getSystemPlaylists()` factory so
 * `branding.appName` resolves at call time (not module load). Qariah's
 * curated reciterIds + expanded surah lists preserved verbatim inside
 * the factory.
 */

import branding from '@/config/branding';

export interface SystemPlaylistItem {
  surahId: number;
  reciterId?: string; // Optional - if not provided, user chooses reciter
  rewayatId?: string; // Optional - if not provided, default rewayat is used
}

export interface SystemPlaylist {
  id: string;
  title: string;
  subtitle?: string;
  description: string;
  backgroundColor: string; // Solid color
  type: 'surah-only' | 'fully-curated';
  items: SystemPlaylistItem[];
  heightMultiplier: 1 | 2; // 1 for single row, 2 for double row
  column: 'left' | 'right';
  order: number;
}

/**
 * System playlists organized by category. Factory so brand strings
 * inside the array resolve `branding.appName` at call time.
 * Total: 12 playlists (6 per column).
 */
export function getSystemPlaylists(): SystemPlaylist[] {
  return [
    // ========== LEFT COLUMN ==========

    // Time-based: Morning Reflections
    {
      id: 'morning-reflections',
      title: 'Morning Reflections',
      description:
        'Start your day with uplifting surahs that inspire gratitude and hope',
      backgroundColor: '#F59E0B', // Warm amber
      type: 'surah-only',
      items: [
        {surahId: 1, reciterId: 'f2820f0a-2872-5314-a1aa-4ae508dce54a'}, // Al-Fatihah — Umm Jamaal Ud-Din
        {surahId: 93, reciterId: '28e402ec-2932-5844-a525-c5d859ff1033'}, // Ad-Duhaa — Maryam Amir
        {surahId: 94, reciterId: 'ee1dc6c7-18ac-54f5-9b08-9b5f07e75620'}, // Ash-Sharh — Farah Amchichou (Warsh)
        {surahId: 112, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // Al-Ikhlas — Farah El Bakkali (Warsh)
        {surahId: 113, reciterId: 'f2820f0a-2872-5314-a1aa-4ae508dce54a'}, // Al-Falaq — Umm Jamaal Ud-Din
        {surahId: 114, reciterId: '28e402ec-2932-5844-a525-c5d859ff1033'}, // An-Nas — Maryam Amir
      ],
      heightMultiplier: 2,
      column: 'left',
      order: 1,
    },

    // Duration: Quick Listen
    {
      id: 'quick-listen',
      title: 'Quick Listen',
      subtitle: '5-15 minutes',
      description:
        'Perfect for short listening sessions during your commute or breaks',
      backgroundColor: '#8B5CF6', // Purple
      type: 'surah-only',
      items: [
        {surahId: 36, reciterId: 'c60599f7-4b7a-5bc6-a916-a227420ea60c'}, // Ya-Sin — Rogayah Sulang
        {surahId: 55, reciterId: '28e402ec-2932-5844-a525-c5d859ff1033'}, // Ar-Rahman — Maryam Amir
        {surahId: 56, reciterId: 'ee1dc6c7-18ac-54f5-9b08-9b5f07e75620'}, // Al-Waqiah — Farah Amchichou (Warsh)
        {surahId: 67, reciterId: '5d73b9d3-9a1e-56ee-b53e-baf5995c15c1'}, // Al-Mulk — Bouchra Ferhat (Warsh)
        {surahId: 78, reciterId: 'f2820f0a-2872-5314-a1aa-4ae508dce54a'}, // An-Naba — Umm Jamaal Ud-Din
      ],
      heightMultiplier: 1,
      column: 'left',
      order: 2,
    },

    // Purpose: Heart Softeners
    {
      id: 'heart-softeners',
      title: 'Heart Softeners',
      description:
        'Emotional and touching recitations that deeply move the soul',
      backgroundColor: '#EC4899', // Pink
      type: 'surah-only',
      items: [
        {surahId: 12, reciterId: '73b70e08-7804-5a69-ba03-6e954d99b13a'}, // Yusuf — Layla Hasan
        {surahId: 18, reciterId: '28e402ec-2932-5844-a525-c5d859ff1033'}, // Al-Kahf — Maryam Amir
        {surahId: 19, reciterId: '5d73b9d3-9a1e-56ee-b53e-baf5995c15c1'}, // Maryam — Bouchra Ferhat (Warsh)
        {surahId: 36, reciterId: 'dfb7e6a3-7235-5285-a87e-b9ac988537a8'}, // Ya-Sin — Hajjah Maria Ulfah
        {surahId: 55, reciterId: '28e402ec-2932-5844-a525-c5d859ff1033'}, // Ar-Rahman — Maryam Amir
        {surahId: 56, reciterId: 'f2820f0a-2872-5314-a1aa-4ae508dce54a'}, // Al-Waqiah — Umm Jamaal Ud-Din
      ],
      heightMultiplier: 2,
      column: 'left',
      order: 3,
    },

    // Educational: Stories of the Prophets
    {
      id: 'stories-prophets',
      title: 'Stories of the Prophets',
      description: 'Surahs featuring narratives of the messengers of Allah',
      backgroundColor: '#0EA5E9', // Sky blue
      type: 'surah-only',
      items: [
        // Sprint 14 — expanded per user feedback to include Al-A'raf
        // (id=7) alongside the existing 13. Surah ordered by id for
        // consistency with the listening flow.
        {surahId: 7, reciterId: 'ee1dc6c7-18ac-54f5-9b08-9b5f07e75620'}, // Al-A'raf — Farah Amchichou
        {surahId: 10, reciterId: 'ee1dc6c7-18ac-54f5-9b08-9b5f07e75620'}, // Yunus — Farah Amchichou (Warsh)
        {surahId: 11, reciterId: '5159dfa7-bbfb-556f-87ed-708edbecace7'}, // Hud — Soumia Almir (Warsh)
        {surahId: 12, reciterId: '226ec728-dcfd-5961-8677-6f96b94de44b'}, // Yusuf — Hajar Hniti (Warsh)
        {surahId: 14, reciterId: '4a8c7fd3-ae35-5f72-9a26-551b1790543c'}, // Ibrahim — Meriem Ahmed (Warsh)
        {surahId: 19, reciterId: '5d73b9d3-9a1e-56ee-b53e-baf5995c15c1'}, // Maryam — Bouchra Ferhat (Warsh)
        {surahId: 20, reciterId: 'a60e3e2d-d55c-542e-b976-3b789a295a6c'}, // Taha (Musa narrative) — Chaymae Yousfi (Warsh)
        {surahId: 21, reciterId: '5159dfa7-bbfb-556f-87ed-708edbecace7'}, // Al-Anbiya (all prophets) — Soumia Almir (Warsh)
        {surahId: 26, reciterId: '4a8c7fd3-ae35-5f72-9a26-551b1790543c'}, // Ash-Shu'ara (Musa, Ibrahim, Nuh…) — Meriem Ahmed (Warsh)
        {surahId: 28, reciterId: '73b70e08-7804-5a69-ba03-6e954d99b13a'}, // Al-Qasas (Musa extended) — Layla Hasan
        {surahId: 37, reciterId: '28e402ec-2932-5844-a525-c5d859ff1033'}, // As-Saffat (Ibrahim, Ismail, Ilyas, Yunus) — Maryam Amir
        {surahId: 38, reciterId: '84ed7bfd-ce83-5b4d-9835-70009f01ae98'}, // Sad (Dawud, Sulayman, Ayyub) — Ramla Hasan
        {surahId: 47, reciterId: 'a887cd93-4673-5f5c-97bc-ec07c95f47f7'}, // Muhammad — Bara'a Mahfouz
        {surahId: 71, reciterId: 'a60e3e2d-d55c-542e-b976-3b789a295a6c'}, // Nuh — Chaymae Yousfi (Warsh)
      ],
      heightMultiplier: 1,
      column: 'left',
      order: 4,
    },

    // Special: Protection & Healing
    {
      id: 'protection-healing',
      title: 'Protection & Healing',
      description: 'Surahs for ruqyah and seeking refuge in Allah',
      backgroundColor: '#10B981', // Emerald
      type: 'surah-only',
      items: [
        {surahId: 1, reciterId: '73b70e08-7804-5a69-ba03-6e954d99b13a'}, // Al-Fatihah — Layla Hasan
        {surahId: 2, reciterId: 'f2820f0a-2872-5314-a1aa-4ae508dce54a'}, // Al-Baqarah (Ayat al-Kursi) — Umm Jamaal Ud-Din
        {surahId: 112, reciterId: '5159dfa7-bbfb-556f-87ed-708edbecace7'}, // Al-Ikhlas — Soumia Almir (Warsh)
        {surahId: 113, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // Al-Falaq — Farah El Bakkali (Warsh)
        {surahId: 114, reciterId: '7292090b-3681-5d3e-a550-4ad1405d83cd'}, // An-Nas — Assiatou Jallow
      ],
      heightMultiplier: 2,
      column: 'left',
      order: 5,
    },

    // Trending: Most Loved
    {
      id: 'most-loved',
      title: 'Most Loved',
      description: 'Community favorites that resonate with listeners worldwide',
      backgroundColor: '#EF4444', // Red
      type: 'surah-only',
      items: [
        {surahId: 18, reciterId: '28e402ec-2932-5844-a525-c5d859ff1033'}, // Al-Kahf — Maryam Amir
        {surahId: 36, reciterId: 'dfb7e6a3-7235-5285-a87e-b9ac988537a8'}, // Ya-Sin — Hajjah Maria Ulfah
        {surahId: 55, reciterId: 'f2820f0a-2872-5314-a1aa-4ae508dce54a'}, // Ar-Rahman — Umm Jamaal Ud-Din
        {surahId: 56, reciterId: '28e402ec-2932-5844-a525-c5d859ff1033'}, // Al-Waqiah — Maryam Amir
        {surahId: 67, reciterId: '5d73b9d3-9a1e-56ee-b53e-baf5995c15c1'}, // Al-Mulk — Bouchra Ferhat (Warsh)
      ],
      heightMultiplier: 1,
      column: 'left',
      order: 6,
    },

    // ========== RIGHT COLUMN ==========

    // Time-based: Evening Serenity
    {
      id: 'evening-serenity',
      title: 'Evening Serenity',
      description: 'Calm and peaceful surahs perfect for evening reflection',
      backgroundColor: '#6366F1', // Indigo
      type: 'surah-only',
      items: [
        {surahId: 36, reciterId: '4a8c7fd3-ae35-5f72-9a26-551b1790543c'}, // Ya-Sin — Meriem Ahmed (Warsh)
        {surahId: 55, reciterId: '28e402ec-2932-5844-a525-c5d859ff1033'}, // Ar-Rahman — Maryam Amir
        {surahId: 67, reciterId: 'a60e3e2d-d55c-542e-b976-3b789a295a6c'}, // Al-Mulk — Chaymae Yousfi (Warsh)
        {surahId: 76, reciterId: 'f2820f0a-2872-5314-a1aa-4ae508dce54a'}, // Al-Insan — Umm Jamaal Ud-Din
        {surahId: 89, reciterId: '5d73b9d3-9a1e-56ee-b53e-baf5995c15c1'}, // Al-Fajr — Bouchra Ferhat (Warsh)
      ],
      heightMultiplier: 1,
      column: 'right',
      order: 1,
    },

    // Time-based: Friday Essentials
    {
      id: 'friday-essentials',
      title: 'Friday Essentials',
      description: 'Al-Kahf and other recommended Friday recitations',
      backgroundColor: '#059669', // Green
      type: 'surah-only',
      items: [
        {surahId: 18, reciterId: '362a60f0-7699-5750-8c8e-fc51d9917121'}, // Al-Kahf (Friday essential) — Zaynab Talha
        {surahId: 32, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // As-Sajdah — Farah El Bakkali (Warsh)
        {surahId: 62, reciterId: 'ee1dc6c7-18ac-54f5-9b08-9b5f07e75620'}, // Al-Jumuah — Farah Amchichou (Warsh)
        {surahId: 76, reciterId: '5159dfa7-bbfb-556f-87ed-708edbecace7'}, // Al-Insan — Soumia Almir (Warsh)
      ],
      heightMultiplier: 2,
      column: 'right',
      order: 2,
    },

    // Purpose: Focus & Study
    {
      id: 'focus-study',
      title: 'Focus & Study',
      description: 'Measured, clear recitations ideal for background listening',
      backgroundColor: '#14B8A6', // Teal
      type: 'surah-only',
      items: [
        {surahId: 2, reciterId: 'f2820f0a-2872-5314-a1aa-4ae508dce54a'}, // Al-Baqarah — Umm Jamaal Ud-Din
        {surahId: 3, reciterId: '5159dfa7-bbfb-556f-87ed-708edbecace7'}, // Ali 'Imran — Soumia Almir (Warsh)
        {surahId: 4, reciterId: 'dfb7e6a3-7235-5285-a87e-b9ac988537a8'}, // An-Nisa — Hajjah Maria Ulfah
        {surahId: 18, reciterId: '362a60f0-7699-5750-8c8e-fc51d9917121'}, // Al-Kahf — Zaynab Talha
      ],
      heightMultiplier: 1,
      column: 'right',
      order: 3,
    },

    // Special: Juz Amma
    {
      id: 'juz-amma',
      title: 'Juz Amma',
      subtitle: 'The 30th Juz',
      description: 'Complete collection of short surahs from the last juz',
      backgroundColor: '#F97316', // Orange
      type: 'surah-only',
      items: [
        {surahId: 78, reciterId: 'f2820f0a-2872-5314-a1aa-4ae508dce54a'}, // An-Naba — Umm Jamaal Ud-Din
        {surahId: 79, reciterId: 'f2820f0a-2872-5314-a1aa-4ae508dce54a'}, // An-Naziat — Umm Jamaal Ud-Din
        {surahId: 80, reciterId: 'f2820f0a-2872-5314-a1aa-4ae508dce54a'}, // Abasa — Umm Jamaal Ud-Din
        {surahId: 81, reciterId: 'f2820f0a-2872-5314-a1aa-4ae508dce54a'}, // At-Takwir — Umm Jamaal Ud-Din
        {surahId: 82, reciterId: '7292090b-3681-5d3e-a550-4ad1405d83cd'}, // Al-Infitar — Assiatou Jallow
        {surahId: 83, reciterId: '7292090b-3681-5d3e-a550-4ad1405d83cd'}, // Al-Mutaffifin — Assiatou Jallow
        {surahId: 84, reciterId: '7292090b-3681-5d3e-a550-4ad1405d83cd'}, // Al-Inshiqaq — Assiatou Jallow
        {surahId: 85, reciterId: 'c1de6a3f-660a-56f1-8fa5-54748dc049ba'}, // Al-Buruj — Muna Abdifatar
        {surahId: 86, reciterId: 'c1de6a3f-660a-56f1-8fa5-54748dc049ba'}, // At-Tariq — Muna Abdifatar
        {surahId: 87, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // Al-Ala — Farah El Bakkali (Warsh)
        {surahId: 88, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // Al-Ghashiyah — Farah El Bakkali (Warsh)
        {surahId: 89, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // Al-Fajr — Farah El Bakkali (Warsh)
        {surahId: 90, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // Al-Balad — Farah El Bakkali (Warsh)
        {surahId: 91, reciterId: '7292090b-3681-5d3e-a550-4ad1405d83cd'}, // Ash-Shams — Assiatou Jallow
        {surahId: 92, reciterId: '7292090b-3681-5d3e-a550-4ad1405d83cd'}, // Al-Layl — Assiatou Jallow
        {surahId: 93, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // Ad-Duha — Farah El Bakkali (Warsh)
        {surahId: 94, reciterId: '7292090b-3681-5d3e-a550-4ad1405d83cd'}, // Ash-Sharh — Assiatou Jallow
        {surahId: 95, reciterId: '7292090b-3681-5d3e-a550-4ad1405d83cd'}, // At-Tin — Assiatou Jallow
        {surahId: 96, reciterId: 'c1de6a3f-660a-56f1-8fa5-54748dc049ba'}, // Al-Alaq — Muna Abdifatar
        {surahId: 97, reciterId: '7292090b-3681-5d3e-a550-4ad1405d83cd'}, // Al-Qadr — Assiatou Jallow
        {surahId: 98, reciterId: '7292090b-3681-5d3e-a550-4ad1405d83cd'}, // Al-Bayyinah — Assiatou Jallow
        {surahId: 99, reciterId: 'c1de6a3f-660a-56f1-8fa5-54748dc049ba'}, // Az-Zalzalah — Muna Abdifatar
        {surahId: 100, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // Al-Adiyat — Farah El Bakkali (Warsh)
        {surahId: 101, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // Al-Qariah — Farah El Bakkali (Warsh)
        {surahId: 102, reciterId: 'c1de6a3f-660a-56f1-8fa5-54748dc049ba'}, // At-Takathur — Muna Abdifatar
        {surahId: 103, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // Al-Asr — Farah El Bakkali (Warsh)
        {surahId: 104, reciterId: 'c1de6a3f-660a-56f1-8fa5-54748dc049ba'}, // Al-Humazah — Muna Abdifatar
        {surahId: 105, reciterId: 'c1de6a3f-660a-56f1-8fa5-54748dc049ba'}, // Al-Fil — Muna Abdifatar
        {surahId: 106, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // Quraysh — Farah El Bakkali (Warsh)
        {surahId: 107, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // Al-Maun — Farah El Bakkali (Warsh)
        {surahId: 108, reciterId: 'c1de6a3f-660a-56f1-8fa5-54748dc049ba'}, // Al-Kawthar — Muna Abdifatar
        {surahId: 109, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // Al-Kafirun — Farah El Bakkali (Warsh)
        {surahId: 110, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // An-Nasr — Farah El Bakkali (Warsh)
        {surahId: 111, reciterId: 'c1de6a3f-660a-56f1-8fa5-54748dc049ba'}, // Al-Masad — Muna Abdifatar
        {surahId: 112, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // Al-Ikhlas — Farah El Bakkali (Warsh)
        {surahId: 113, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // Al-Falaq — Farah El Bakkali (Warsh)
        {surahId: 114, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // An-Nas — Farah El Bakkali (Warsh)
      ],
      heightMultiplier: 2,
      column: 'right',
      order: 4,
    },

    // Special: Memorization Station
    {
      id: 'memorization-station',
      title: 'Memorization Station',
      description:
        'Short surahs perfect for those beginning their memorization',
      backgroundColor: '#7C3AED', // Violet
      type: 'surah-only',
      items: [
        {surahId: 1, reciterId: '5159dfa7-bbfb-556f-87ed-708edbecace7'}, // Al-Fatihah — Soumia Almir (Warsh)
        {surahId: 103, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // Al-Asr — Farah El Bakkali (Warsh)
        {surahId: 108, reciterId: '7292090b-3681-5d3e-a550-4ad1405d83cd'}, // Al-Kawthar — Assiatou Jallow
        {surahId: 109, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // Al-Kafirun — Farah El Bakkali (Warsh)
        {surahId: 110, reciterId: 'f2820f0a-2872-5314-a1aa-4ae508dce54a'}, // An-Nasr — Umm Jamaal Ud-Din
        {surahId: 111, reciterId: '7292090b-3681-5d3e-a550-4ad1405d83cd'}, // Al-Masad — Assiatou Jallow
        {surahId: 112, reciterId: '5159dfa7-bbfb-556f-87ed-708edbecace7'}, // Al-Ikhlas — Soumia Almir (Warsh)
        {surahId: 113, reciterId: 'f2820f0a-2872-5314-a1aa-4ae508dce54a'}, // Al-Falaq — Umm Jamaal Ud-Din
        {surahId: 114, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // An-Nas — Farah El Bakkali (Warsh)
      ],
      heightMultiplier: 1,
      column: 'right',
      order: 5,
    },

    // Trending: Qariah Essentials
    {
      id: 'bayaan-essentials',
      title: `${branding.appName} Essentials`,
      description: 'Our top recommendations for every listener',
      backgroundColor: '#DC2626', // Deep red
      type: 'surah-only',
      items: [
        {surahId: 1, reciterId: '362a60f0-7699-5750-8c8e-fc51d9917121'}, // Al-Fatihah — Zaynab Talha
        {surahId: 18, reciterId: 'ee1dc6c7-18ac-54f5-9b08-9b5f07e75620'}, // Al-Kahf — Farah Amchichou (Warsh)
        {surahId: 36, reciterId: '4a8c7fd3-ae35-5f72-9a26-551b1790543c'}, // Ya-Sin — Meriem Ahmed (Warsh)
        {surahId: 55, reciterId: 'dfb7e6a3-7235-5285-a87e-b9ac988537a8'}, // Ar-Rahman — Hajjah Maria Ulfah
        {surahId: 67, reciterId: '3c6d9e76-fd52-593b-ad55-68afdc1ae826'}, // Al-Mulk — Farah El Bakkali (Warsh)
        {surahId: 112, reciterId: '7be32ec8-ddaa-52a0-8bf8-b2cea0108f05'}, // Al-Ikhlas — Khadija Azdad (Warsh)
      ],
      heightMultiplier: 2,
      column: 'right',
      order: 6,
    },
  ];
}

/**
 * Get a system playlist by ID
 */
export function getSystemPlaylistById(id: string): SystemPlaylist | undefined {
  return getSystemPlaylists().find(playlist => playlist.id === id);
}

/**
 * Get all system playlists
 */
export function getAllSystemPlaylists(): SystemPlaylist[] {
  return getSystemPlaylists();
}

/**
 * Get system playlists organized by column for grid layout
 */
export function getSystemPlaylistsByColumn(): {
  left: SystemPlaylist[];
  right: SystemPlaylist[];
} {
  const all = getSystemPlaylists();
  const left = all
    .filter(p => p.column === 'left')
    .sort((a, b) => a.order - b.order);
  const right = all
    .filter(p => p.column === 'right')
    .sort((a, b) => a.order - b.order);
  return {left, right};
}
