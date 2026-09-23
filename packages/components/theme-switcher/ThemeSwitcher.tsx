import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Slider } from '../ui/slider';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '../ui/collapsible';
import './shadows.css';

const COLOR_VARS = [
  '--background',
  '--foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--accent',
  '--accent-foreground',
  '--muted',
  '--muted-foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--destructive',
  '--destructive-foreground',
  '--border',
  '--input',
  '--ring',
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--sidebar-background',
  '--sidebar-foreground',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-accent',
  '--sidebar-accent-foreground',
  '--sidebar-border',
  '--sidebar-ring',
] as const;

interface ThemeColors {
  background: string;
  foreground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  accent: string;
  accentForeground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  muted: string;
  mutedForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarBorder: string;
  sidebarRing: string;
}

interface ThemeConfig {
  id: string;
  name: string;
  previewPalette: [string, string, string, string];
  colors: ThemeColors;
  fonts: { sans: string; mono: string };
  radius: string;
  shadow: {
    x: string;
    y: string;
    blur: string;
    spread: string;
    opacity: string;
    color: string;
  };
}

const THEMES: Record<string, ThemeConfig> = {
  default: {
    id: 'default',
    name: 'Default',
    previewPalette: [
      'hsl(210,40%,98%)',
      'hsl(210,40%,96%)',
      'hsl(221,83%,53%)',
      'hsl(222,84%,5%)',
    ],
    colors: {
      background: '0 0% 100%',
      foreground: '222 84% 5%',
      primary: '221 83% 53%',
      primaryForeground: '210 40% 98%',
      secondary: '210 40% 96%',
      secondaryForeground: '222 47% 1%',
      accent: '210 40% 96%',
      accentForeground: '222 47% 1%',
      card: '0 0% 100%',
      cardForeground: '222 84% 5%',
      popover: '0 0% 100%',
      popoverForeground: '222 84% 5%',
      muted: '210 40% 96%',
      mutedForeground: '215 16% 46%',
      destructive: '0 84% 60%',
      destructiveForeground: '210 40% 98%',
      border: '214.3 31.8% 91%',
      input: '214.3 31.8% 91%',
      ring: '221 83% 53%',
      chart1: '221 83% 53%',
      chart2: '12 76% 61%',
      chart3: '173 58% 39%',
      chart4: '197 37% 24%',
      chart5: '43 74% 66%',
      sidebar: '0 0% 100%',
      sidebarForeground: '222 84% 5%',
      sidebarPrimary: '221 83% 53%',
      sidebarPrimaryForeground: '210 40% 98%',
      sidebarAccent: '210 40% 96%',
      sidebarAccentForeground: '222 47% 1%',
      sidebarBorder: '214.3 31.8% 91%',
      sidebarRing: '221 83% 53%',
    },
    fonts: {
      sans: "'Inter', 'Helvetica Neue', sans-serif",
      mono: "'Geist Mono', 'Courier New', monospace",
    },
    radius: '0.5rem',
    shadow: {
      x: '0px',
      y: '1px',
      blur: '2px',
      spread: '0px',
      opacity: '0.05',
      color: '#000000',
    },
  },

  dark: {
    id: 'dark',
    name: 'Dark',
    previewPalette: [
      'hsl(222,84%,5%)',
      'hsl(217,32%,17%)',
      'hsl(217,91%,60%)',
      'hsl(210,40%,98%)',
    ],
    colors: {
      background: '0 0% 9.0196%',
      foreground: '0 0% 89.8039%',
      primary: '217.2193 91.2195% 59.8039%',
      primaryForeground: '0 0% 100%',
      secondary: '0 0% 14.9020%',
      secondaryForeground: '0 0% 89.8039%',
      accent: '224.4444 64.2857% 32.9412%',
      accentForeground: '213.3333 96.9231% 87.2549%',
      card: '0 0% 14.9020%',
      cardForeground: '0 0% 89.8039%',
      popover: '0 0% 14.9020%',
      popoverForeground: '0 0% 89.8039%',
      muted: '0 0% 12.1569%',
      mutedForeground: '0 0% 63.9216%',
      destructive: '0 84.2365% 60.1961%',
      destructiveForeground: '0 0% 100%',
      border: '0 0% 25.0980%',
      input: '0 0% 25.0980%',
      ring: '217.2193 91.2195% 59.8039%',
      chart1: '213.1169 93.9024% 67.8431%',
      chart2: '217.2193 91.2195% 59.8039%',
      chart3: '221.2121 83.1933% 53.3333%',
      chart4: '224.2781 76.3265% 48.0392%',
      chart5: '225.9310 70.7317% 40.1961%',
      sidebar: '0 0% 9.0196%',
      sidebarForeground: '0 0% 89.8039%',
      sidebarPrimary: '217.2193 91.2195% 59.8039%',
      sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '224.4444 64.2857% 32.9412%',
      sidebarAccentForeground: '213.3333 96.9231% 87.2549%',
      sidebarBorder: '0 0% 25.0980%',
      sidebarRing: '217.2193 91.2195% 59.8039%',
    },
    fonts: {
      sans: "'Inter', 'Helvetica Neue', sans-serif",
      mono: "'Geist Mono', 'Courier New', monospace",
    },
    radius: '0.5rem',
    shadow: {
      x: '0px',
      y: '1px',
      blur: '2px',
      spread: '0px',
      opacity: '0.05',
      color: '#000000',
    },
  },

  'solar-dusk': {
    id: 'solar-dusk',
    name: 'Solar Dusk',
    previewPalette: [
      'hsl(40,60%,98%)',
      'hsl(34.3,60.9%,72.9%)',
      'hsl(25.96,90.5%,37.1%)',
      'hsl(20.87,18.4%,24.5%)',
    ],
    colors: {
      background: '40.0000 60.0000% 98.0392%',
      foreground: '20.8696 18.4000% 24.5098%',
      primary: '25.9649 90.4762% 37.0588%',
      primaryForeground: '0 0% 100%',
      secondary: '34.2857 60.8696% 72.9412%',
      secondaryForeground: '33.3333 5.4545% 32.3529%',
      accent: '34.2857 68.2927% 83.9216%',
      accentForeground: '33.3333 5.4545% 32.3529%',
      card: '36.0000 41.6667% 95.2941%',
      cardForeground: '20.8696 18.4000% 24.5098%',
      popover: '36.0000 41.6667% 95.2941%',
      popoverForeground: '20.8696 18.4000% 24.5098%',
      muted: '39.1304 45.0980% 90.0000%',
      mutedForeground: '25.0000 5.2632% 44.7059%',
      destructive: '0 70% 35.2941%',
      destructiveForeground: '0 0% 100%',
      border: '43.5000 42.5532% 81.5686%',
      input: '43.5000 42.5532% 81.5686%',
      ring: '25.9649 90.4762% 37.0588%',
      chart1: '25.9649 90.4762% 37.0588%',
      chart2: '25.0000 5.2632% 44.7059%',
      chart3: '35.4545 91.6667% 32.9412%',
      chart4: '25.0000 5.2632% 44.7059%',
      chart5: '40.6061 96.1165% 40.3922%',
      sidebar: '39.1304 45.0980% 90.0000%',
      sidebarForeground: '20.8696 18.4000% 24.5098%',
      sidebarPrimary: '25.9649 90.4762% 37.0588%',
      sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '35.4545 91.6667% 32.9412%',
      sidebarAccentForeground: '0 0% 100%',
      sidebarBorder: '43.5000 42.5532% 81.5686%',
      sidebarRing: '25.9649 90.4762% 37.0588%',
    },
    fonts: { sans: "'Oxanium', sans-serif", mono: "'Fira Code', monospace" },
    radius: '0.3rem',
    shadow: {
      x: '0px',
      y: '2px',
      blur: '3px',
      spread: '0px',
      opacity: '0.18',
      color: '#4A4238',
    },
  },

  'amethyst-haze': {
    id: 'amethyst-haze',
    name: 'Amethyst Haze',
    previewPalette: [
      'hsl(260,23.1%,97.5%)',
      'hsl(260.4,22.9%,57.3%)',
      'hsl(342.46,56.52%,77.45%)',
      'hsl(243.16,13.67%,27.25%)',
    ],
    colors: {
      background: '260 23.0769% 97.4510%',
      foreground: '243.1579 13.6691% 27.2549%',
      primary: '260.4000 22.9358% 57.2549%',
      primaryForeground: '260 23.0769% 97.4510%',
      secondary: '258.9474 33.3333% 88.8235%',
      secondaryForeground: '243.1579 13.6691% 27.2549%',
      accent: '342.4615 56.5217% 77.4510%',
      accentForeground: '343.4483 23.9669% 23.7255%',
      card: '0 0% 100%',
      cardForeground: '243.1579 13.6691% 27.2549%',
      popover: '0 0% 100%',
      popoverForeground: '243.1579 13.6691% 27.2549%',
      muted: '258.0000 15.1515% 87.0588%',
      mutedForeground: '247.5000 10.3448% 45.4902%',
      destructive: '0 62.1891% 60.5882%',
      destructiveForeground: '260 23.0769% 97.4510%',
      border: '258.7500 17.3913% 81.9608%',
      input: '260.0000 23.0769% 92.3529%',
      ring: '260.4000 22.9358% 57.2549%',
      chart1: '260.4000 22.9358% 57.2549%',
      chart2: '342.4615 56.5217% 77.4510%',
      chart3: '158.7692 31.4010% 59.4118%',
      chart4: '35.7576 76.7442% 74.7059%',
      chart5: '215.8209 54.4715% 75.8824%',
      sidebar: '260.0000 23.0769% 94.9020%',
      sidebarForeground: '243.1579 13.6691% 27.2549%',
      sidebarPrimary: '260.4000 22.9358% 57.2549%',
      sidebarPrimaryForeground: '260 23.0769% 97.4510%',
      sidebarAccent: '342.4615 56.5217% 77.4510%',
      sidebarAccentForeground: '343.4483 23.9669% 23.7255%',
      sidebarBorder: '261.4286 18.4211% 85.0980%',
      sidebarRing: '260.4000 22.9358% 57.2549%',
    },
    fonts: { sans: "'Manrope', sans-serif", mono: "'Fira Code', monospace" },
    radius: '0.5rem',
    shadow: {
      x: '1px',
      y: '2px',
      blur: '5px',
      spread: '1px',
      opacity: '0.06',
      color: '#000000',
    },
  },

  bubblegum: {
    id: 'bubblegum',
    name: 'Bubblegum',
    previewPalette: [
      'hsl(330,47%,93%)',
      'hsl(42,91%,82%)',
      'hsl(326,58%,56%)',
      'hsl(182,44%,68%)',
    ],
    colors: {
      background: '330 47.0588% 93.3333%',
      foreground: '0 0% 35.6863%',
      primary: '325.5814 57.8475% 56.2745%',
      primaryForeground: '0 0% 100%',
      secondary: '181.6901 43.5583% 68.0392%',
      secondaryForeground: '0 0% 20%',
      accent: '42.1429 91.3043% 81.9608%',
      accentForeground: '0 0% 20%',
      card: '41.5385 92.8571% 89.0196%',
      cardForeground: '0 0% 35.6863%',
      popover: '0 0% 100%',
      popoverForeground: '0 0% 35.6863%',
      muted: '190.5263 58.7629% 80.9804%',
      mutedForeground: '0 0% 47.8431%',
      destructive: '359.5652 92.0000% 70.5882%',
      destructiveForeground: '0 0% 100%',
      border: '325.5814 57.8475% 56.2745%',
      input: '0 0% 89.4118%',
      ring: '330 70.2381% 67.0588%',
      chart1: '330 70.2381% 67.0588%',
      chart2: '190.2128 61.8421% 70.1961%',
      chart3: '42.1429 91.3043% 81.9608%',
      chart4: '329.6386 77.5701% 79.0196%',
      chart5: '330.6294 64.1256% 56.2745%',
      sidebar: '326.2500 69.5652% 90.9804%',
      sidebarForeground: '0 0% 20%',
      sidebarPrimary: '330.3659 81.1881% 60.3922%',
      sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '327.4074 87.0968% 81.7647%',
      sidebarAccentForeground: '0 0% 20%',
      sidebarBorder: '268.6957 100.0000% 95.4902%',
      sidebarRing: '330.3659 81.1881% 60.3922%',
    },
    fonts: { sans: "'Poppins', sans-serif", mono: "'Fira Code', monospace" },
    radius: '0.4rem',
    shadow: {
      x: '3px',
      y: '3px',
      blur: '0px',
      spread: '0px',
      opacity: '1.0',
      color: '#d07aaa',
    },
  },

  'vintage-paper': {
    id: 'vintage-paper',
    name: 'Vintage Paper',
    previewPalette: [
      'hsl(44,42.86%,93.14%)',
      'hsl(40.65,34.83%,82.55%)',
      'hsl(30,33.87%,48.63%)',
      'hsl(28.57,16.54%,24.90%)',
    ],
    colors: {
      background: '44.0000 42.8571% 93.1373%',
      foreground: '28.5714 16.5354% 24.9020%',
      primary: '30.0000 33.8710% 48.6275%',
      primaryForeground: '0 0% 100%',
      secondary: '40.6452 34.8315% 82.5490%',
      secondaryForeground: '28.9655 18.7097% 30.3922%',
      accent: '42.8571 32.8125% 74.9020%',
      accentForeground: '28.5714 16.5354% 24.9020%',
      card: '42.0000 100.0000% 98.0392%',
      cardForeground: '28.5714 16.5354% 24.9020%',
      popover: '42.0000 100.0000% 98.0392%',
      popoverForeground: '28.5714 16.5354% 24.9020%',
      muted: '39 34.4828% 88.6275%',
      mutedForeground: '32.3077 18.4834% 41.3725%',
      destructive: '9.8438 54.7009% 45.8824%',
      destructiveForeground: '0 0% 100%',
      border: '40.0000 31.4286% 79.4118%',
      input: '40.0000 31.4286% 79.4118%',
      ring: '30.0000 33.8710% 48.6275%',
      chart1: '30.0000 33.8710% 48.6275%',
      chart2: '31.3846 29.9539% 42.5490%',
      chart3: '33.6842 32.9480% 33.9216%',
      chart4: '29.1176 30.9091% 56.8627%',
      chart5: '30 33.6842% 62.7451%',
      sidebar: '39 34.4828% 88.6275%',
      sidebarForeground: '28.5714 16.5354% 24.9020%',
      sidebarPrimary: '30.0000 33.8710% 48.6275%',
      sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '42.8571 32.8125% 74.9020%',
      sidebarAccentForeground: '28.5714 16.5354% 24.9020%',
      sidebarBorder: '40.0000 31.4286% 79.4118%',
      sidebarRing: '30.0000 33.8710% 48.6275%',
    },
    fonts: {
      sans: "'Libre Baskerville', serif",
      mono: "'IBM Plex Mono', monospace",
    },
    radius: '0.25rem',
    shadow: {
      x: '2px',
      y: '3px',
      blur: '5px',
      spread: '0px',
      opacity: '0.12',
      color: '#2e2318',
    },
  },

  'starry-night': {
    id: 'starry-night',
    name: 'Starry Night',
    previewPalette: [
      'hsl(230,20%,11.8%)',
      'hsl(237.4,24.7%,18.2%)',
      'hsl(47.8,100%,70%)',
      'hsl(221.5,35.1%,92.7%)',
    ],
    colors: {
      background: '230 20.0000% 11.7647%',
      foreground: '221.5385 35.1351% 92.7451%',
      primary: '220.5882 46.7890% 42.7451%',
      primaryForeground: '47.8431 100.0000% 70%',
      secondary: '47.8431 100.0000% 70%',
      secondaryForeground: '237.3913 24.7312% 18.2353%',
      accent: '220.3846 63.4146% 83.9216%',
      accentForeground: '230 20.0000% 11.7647%',
      card: '237.3913 24.7312% 18.2353%',
      cardForeground: '221.5385 35.1351% 92.7451%',
      popover: '237.3913 24.7312% 18.2353%',
      popoverForeground: '47.8431 100.0000% 70%',
      muted: '236.6667 23.6842% 14.9020%',
      mutedForeground: '218.4615 17.1806% 55.4902%',
      destructive: '336.2791 36.7521% 45.8824%',
      destructiveForeground: '47.8431 100.0000% 70%',
      border: '236.4706 15.8879% 20.9804%',
      input: '220.5882 46.7890% 42.7451%',
      ring: '47.8431 100.0000% 70%',
      chart1: '220.5882 46.7890% 42.7451%',
      chart2: '47.8431 100.0000% 70%',
      chart3: '201.6867 40.0966% 59.4118%',
      chart4: '218.4615 17.1806% 55.4902%',
      chart5: '336.2791 36.7521% 45.8824%',
      sidebar: '237.3913 24.7312% 18.2353%',
      sidebarForeground: '221.5385 35.1351% 92.7451%',
      sidebarPrimary: '220.5882 46.7890% 42.7451%',
      sidebarPrimaryForeground: '47.8431 100.0000% 70%',
      sidebarAccent: '47.8431 100.0000% 70%',
      sidebarAccentForeground: '237.3913 24.7312% 18.2353%',
      sidebarBorder: '236.4706 15.8879% 20.9804%',
      sidebarRing: '47.8431 100.0000% 70%',
    },
    fonts: {
      sans: "'Inter', 'Helvetica Neue', sans-serif",
      mono: "'Courier New', monospace",
    },
    radius: '0.5rem',
    shadow: {
      x: '0',
      y: '1px',
      blur: '3px',
      spread: '0px',
      opacity: '0.1',
      color: '#000000',
    },
  },

  neobrutal: {
    id: 'neobrutal',
    name: 'Neobrutalism',
    previewPalette: [
      'hsl(0,0%,100%)',
      'hsl(0,100%,60%)',
      'hsl(216,100%,50%)',
      'hsl(0,0%,0%)',
    ],
    colors: {
      background: '0 0% 100%',
      foreground: '0 0% 0%',
      primary: '0 100% 60%',
      primaryForeground: '0 0% 100%',
      secondary: '60 100% 50%',
      secondaryForeground: '0 0% 0%',
      accent: '216 100% 50%',
      accentForeground: '0 0% 100%',
      card: '0 0% 100%',
      cardForeground: '0 0% 0%',
      popover: '0 0% 100%',
      popoverForeground: '0 0% 0%',
      muted: '0 0% 94.1176%',
      mutedForeground: '0 0% 20%',
      destructive: '0 0% 0%',
      destructiveForeground: '0 0% 100%',
      border: '0 0% 0%',
      input: '0 0% 0%',
      ring: '0 100% 60%',
      chart1: '0 100% 60%',
      chart2: '60 100% 50%',
      chart3: '216 100% 50%',
      chart4: '120 100% 40%',
      chart5: '300 100% 40%',
      sidebar: '0 0% 94.1176%',
      sidebarForeground: '0 0% 0%',
      sidebarPrimary: '0 100% 60%',
      sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '216 100% 50%',
      sidebarAccentForeground: '0 0% 100%',
      sidebarBorder: '0 0% 0%',
      sidebarRing: '0 100% 60%',
    },
    fonts: { sans: "'DM Sans', sans-serif", mono: "'Space Mono', monospace" },
    radius: '0px',
    shadow: {
      x: '4px',
      y: '4px',
      blur: '0px',
      spread: '0px',
      opacity: '1',
      color: '#000000',
    },
  },

  'pitch-black': {
    id: 'pitch-black',
    name: 'Pitch Black',
    previewPalette: [
      'hsl(0,0%,0%)',
      'hsl(223.81,0%,19.89%)',
      'hsl(223.81,0%,100%)',
      'hsl(223.81,0%,64.47%)',
    ],
    colors: {
      background: '0 0% 0%',
      foreground: '223.8136 0% 100%',
      primary: '223.8136 0% 100%',
      primaryForeground: '0 0% 0%',
      secondary: '223.8136 0.0000% 13.1499%',
      secondaryForeground: '223.8136 0% 100%',
      accent: '223.8136 0.0000% 19.8916%',
      accentForeground: '223.8136 0% 100%',
      card: '223.8136 0.0000% 3.5452%',
      cardForeground: '223.8136 0% 100%',
      popover: '223.8136 0.0000% 6.8692%',
      popoverForeground: '223.8136 0% 100%',
      muted: '223.8136 0.0000% 11.3040%',
      mutedForeground: '223.8136 0.0000% 64.4710%',
      destructive: '359.9132 100.2494% 67.8807%',
      destructiveForeground: '0 0% 0%',
      border: '223.8136 0.0000% 14.0871%',
      input: '223.8136 0.0000% 19.8916%',
      ring: '223.8136 0.0000% 64.4710%',
      chart1: '223.8136 0% 100%',
      chart2: '223.8136 0.0000% 64.4710%',
      chart3: '223.8136 0.0000% 45.6078%',
      chart4: '223.8136 0.0000% 32.3067%',
      chart5: '223.8136 0.0001% 89.5577%',
      sidebar: '223.8136 0.0000% 6.8692%',
      sidebarForeground: '223.8136 0% 100%',
      sidebarPrimary: '223.8136 0% 100%',
      sidebarPrimaryForeground: '0 0% 0%',
      sidebarAccent: '223.8136 0.0000% 19.8916%',
      sidebarAccentForeground: '223.8136 0% 100%',
      sidebarBorder: '223.8136 0.0000% 19.8916%',
      sidebarRing: '223.8136 0.0000% 64.4710%',
    },
    fonts: {
      sans: "'Geist', sans-serif",
      mono: "'Geist Mono', 'Courier New', monospace",
    },
    radius: '0.5rem',
    shadow: {
      x: '0px',
      y: '1px',
      blur: '2px',
      spread: '0px',
      opacity: '0.18',
      color: '#000000',
    },
  },

  chirp: {
    id: 'chirp',
    name: 'Chirp',
    previewPalette: [
      'hsl(0,0%,100%)',
      'hsl(211.58,51.35%,92.75%)',
      'hsl(203.89,88.28%,53.14%)',
      'hsl(210,25%,7.84%)',
    ],
    colors: {
      background: '0 0% 100%',
      foreground: '210 25% 7.8431%',
      primary: '203.8863 88.2845% 53.1373%',
      primaryForeground: '0 0% 100%',
      secondary: '210 25% 7.8431%',
      secondaryForeground: '0 0% 100%',
      accent: '211.5789 51.3514% 92.7451%',
      accentForeground: '203.8863 88.2845% 53.1373%',
      card: '180 6.6667% 97.0588%',
      cardForeground: '210 25% 7.8431%',
      popover: '0 0% 100%',
      popoverForeground: '210 25% 7.8431%',
      muted: '240 1.9608% 90%',
      mutedForeground: '210 25% 7.8431%',
      destructive: '356.3033 90.5579% 54.3137%',
      destructiveForeground: '0 0% 100%',
      border: '201.4286 30.4348% 90.9804%',
      input: '200 23.0769% 97.4510%',
      ring: '202.8169 89.1213% 53.1373%',
      chart1: '203.8863 88.2845% 53.1373%',
      chart2: '159.7826 100% 36.0784%',
      chart3: '42.0290 92.8251% 56.2745%',
      chart4: '147.1429 78.5047% 41.9608%',
      chart5: '341.4894 75.2000% 50.9804%',
      sidebar: '180 6.6667% 97.0588%',
      sidebarForeground: '210 25% 7.8431%',
      sidebarPrimary: '203.8863 88.2845% 53.1373%',
      sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '211.5789 51.3514% 92.7451%',
      sidebarAccentForeground: '203.8863 88.2845% 53.1373%',
      sidebarBorder: '205.0000 25.0000% 90.5882%',
      sidebarRing: '202.8169 89.1213% 53.1373%',
    },
    fonts: {
      sans: "'Open Sans', sans-serif",
      mono: "'Source Code Pro', monospace",
    },
    radius: '1.3rem',
    shadow: {
      x: '0px',
      y: '2px',
      blur: '0px',
      spread: '0px',
      opacity: '0',
      color: '#000000',
    },
  },

  cyberpunk: {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    previewPalette: [
      'hsl(240,41.5%,8%)',
      'hsl(240,35.5%,18.2%)',
      'hsl(312.9,100%,50%)',
      'hsl(217.5,26.7%,94.1%)',
    ],
    colors: {
      background: '240 41.4634% 8.0392%',
      foreground: '217.5000 26.6667% 94.1176%',
      primary: '312.9412 100% 50%',
      primaryForeground: '0 0% 100%',
      secondary: '240 35.4839% 18.2353%',
      secondaryForeground: '217.5000 26.6667% 94.1176%',
      accent: '168 100% 50%',
      accentForeground: '240 41.4634% 8.0392%',
      card: '240 35.4839% 18.2353%',
      cardForeground: '217.5000 26.6667% 94.1176%',
      popover: '240 35.4839% 18.2353%',
      popoverForeground: '217.5000 26.6667% 94.1176%',
      muted: '240 39.1304% 13.5294%',
      mutedForeground: '232.1053 17.5926% 57.6471%',
      destructive: '14.3529 100% 50%',
      destructiveForeground: '0 0% 100%',
      border: '240 34.2857% 27.4510%',
      input: '240 34.2857% 27.4510%',
      ring: '312.9412 100% 50%',
      chart1: '312.9412 100% 50%',
      chart2: '273.8824 100% 50%',
      chart3: '186.1176 100% 50%',
      chart4: '168 100% 50%',
      chart5: '54.1176 100% 50%',
      sidebar: '240 41.4634% 8.0392%',
      sidebarForeground: '217.5000 26.6667% 94.1176%',
      sidebarPrimary: '312.9412 100% 50%',
      sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '168 100% 50%',
      sidebarAccentForeground: '240 41.4634% 8.0392%',
      sidebarBorder: '240 34.2857% 27.4510%',
      sidebarRing: '312.9412 100% 50%',
    },
    fonts: { sans: "'Outfit', sans-serif", mono: "'Fira Code', monospace" },
    radius: '0.5rem',
    shadow: {
      x: '0px',
      y: '4px',
      blur: '8px',
      spread: '-2px',
      opacity: '0.1',
      color: '#000000',
    },
  },

  terminal: {
    id: 'terminal',
    name: 'Terminal',
    previewPalette: [
      'hsl(223.8,0%,98.7%)',
      'hsl(223.8,0%,92.1%)',
      'hsl(0,0%,0%)',
      'hsl(223.8,0%,32.3%)',
    ],
    colors: {
      background: '223.8136 0.0005% 98.6829%',
      foreground: '0 0% 0%',
      primary: '0 0% 0%',
      primaryForeground: '223.8136 0% 100%',
      secondary: '223.8136 0.0001% 92.1478%',
      secondaryForeground: '0 0% 0%',
      accent: '223.8136 0.0001% 92.1478%',
      accentForeground: '0 0% 0%',
      card: '223.8136 0% 100%',
      cardForeground: '0 0% 0%',
      popover: '223.8136 0.0005% 98.6829%',
      popoverForeground: '0 0% 0%',
      muted: '223.8136 0.0002% 96.0587%',
      mutedForeground: '223.8136 0.0000% 32.3067%',
      destructive: '358.4334 74.9120% 59.7455%',
      destructiveForeground: '223.8136 0% 100%',
      border: '223.8136 0.0001% 89.5577%',
      input: '223.8136 0.0001% 92.1478%',
      ring: '0 0% 0%',
      chart1: '0 0% 0%',
      chart2: '223.8136 0.0000% 32.3067%',
      chart3: '223.8136 0.0000% 64.4710%',
      chart4: '223.8136 0.0001% 89.5577%',
      chart5: '223.8136 0.0000% 45.6078%',
      sidebar: '223.8136 0.0005% 98.6829%',
      sidebarForeground: '0 0% 0%',
      sidebarPrimary: '0 0% 0%',
      sidebarPrimaryForeground: '223.8136 0% 100%',
      sidebarAccent: '223.8136 0.0001% 92.1478%',
      sidebarAccentForeground: '0 0% 0%',
      sidebarBorder: '223.8136 0.0001% 92.1478%',
      sidebarRing: '0 0% 0%',
    },
    fonts: {
      sans: "'Geist', sans-serif",
      mono: "'Geist Mono', 'Courier New', monospace",
    },
    radius: '0.5rem',
    shadow: {
      x: '0px',
      y: '1px',
      blur: '2px',
      spread: '0px',
      opacity: '0.18',
      color: '#000000',
    },
  },

  nature: {
    id: 'nature',
    name: 'Nature',
    previewPalette: [
      'hsl(37.5,36.4%,95.7%)',
      'hsl(122.4,39.4%,49.2%)',
      'hsl(123,46.2%,33.5%)',
      'hsl(8.89,27.8%,19%)',
    ],
    colors: {
      background: '37.5000 36.3636% 95.6863%',
      foreground: '8.8889 27.8351% 19.0196%',
      primary: '123.0380 46.1988% 33.5294%',
      primaryForeground: '0 0% 100%',
      secondary: '124.6154 39.3939% 93.5294%',
      secondaryForeground: '124.4776 55.3719% 23.7255%',
      accent: '122 37.5000% 84.3137%',
      accentForeground: '124.4776 55.3719% 23.7255%',
      card: '37.5000 36.3636% 95.6863%',
      cardForeground: '8.8889 27.8351% 19.0196%',
      popover: '37.5000 36.3636% 95.6863%',
      popoverForeground: '8.8889 27.8351% 19.0196%',
      muted: '33.7500 34.7826% 90.9804%',
      mutedForeground: '15.0000 25.2874% 34.1176%',
      destructive: '0 66.3866% 46.6667%',
      destructiveForeground: '0 0% 100%',
      border: '33.9130 27.0588% 83.3333%',
      input: '33.9130 27.0588% 83.3333%',
      ring: '123.0380 46.1988% 33.5294%',
      chart1: '122.4242 39.4422% 49.2157%',
      chart2: '122.7907 43.4343% 38.8235%',
      chart3: '123.0380 46.1988% 33.5294%',
      chart4: '124.4776 55.3719% 23.7255%',
      chart5: '125.7143 51.2195% 8.0392%',
      sidebar: '33.7500 34.7826% 90.9804%',
      sidebarForeground: '8.8889 27.8351% 19.0196%',
      sidebarPrimary: '123.0380 46.1988% 33.5294%',
      sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '122 37.5000% 84.3137%',
      sidebarAccentForeground: '124.4776 55.3719% 23.7255%',
      sidebarBorder: '33.9130 27.0588% 83.3333%',
      sidebarRing: '123.0380 46.1988% 33.5294%',
    },
    fonts: {
      sans: "'Montserrat', sans-serif",
      mono: "'Source Code Pro', monospace",
    },
    radius: '0.5rem',
    shadow: {
      x: '0',
      y: '1px',
      blur: '3px',
      spread: '0px',
      opacity: '0.1',
      color: '#000000',
    },
  },

  mono: {
    id: 'mono',
    name: 'Mono',
    previewPalette: [
      'hsl(0,0%,100%)',
      'hsl(0,0%,96.1%)',
      'hsl(0,0%,45.1%)',
      'hsl(0,0%,3.9%)',
    ],
    colors: {
      background: '0 0% 100%',
      foreground: '0 0% 3.9216%',
      primary: '0 0% 45.0980%',
      primaryForeground: '0 0% 98.0392%',
      secondary: '0 0% 96.0784%',
      secondaryForeground: '0 0% 9.0196%',
      accent: '0 0% 96.0784%',
      accentForeground: '0 0% 9.0196%',
      card: '0 0% 100%',
      cardForeground: '0 0% 3.9216%',
      popover: '0 0% 100%',
      popoverForeground: '0 0% 3.9216%',
      muted: '0 0% 96.0784%',
      mutedForeground: '0 0% 44.3137%',
      destructive: '357.1429 100% 45.2941%',
      destructiveForeground: '0 0% 96.0784%',
      border: '0 0% 89.8039%',
      input: '0 0% 89.8039%',
      ring: '0 0% 63.1373%',
      chart1: '0 0% 45.0980%',
      chart2: '0 0% 45.0980%',
      chart3: '0 0% 45.0980%',
      chart4: '0 0% 45.0980%',
      chart5: '0 0% 45.0980%',
      sidebar: '0 0% 98.0392%',
      sidebarForeground: '0 0% 3.9216%',
      sidebarPrimary: '0 0% 9.0196%',
      sidebarPrimaryForeground: '0 0% 98.0392%',
      sidebarAccent: '0 0% 96.0784%',
      sidebarAccentForeground: '0 0% 9.0196%',
      sidebarBorder: '0 0% 89.8039%',
      sidebarRing: '0 0% 63.1373%',
    },
    fonts: {
      sans: "'Geist Mono', 'Courier New', monospace",
      mono: "'Geist Mono', 'Courier New', monospace",
    },
    radius: '0rem',
    shadow: {
      x: '0px',
      y: '1px',
      blur: '0px',
      spread: '0px',
      opacity: '0',
      color: '#000000',
    },
  },

  midnight: {
    id: 'midnight',
    name: 'Midnight',
    previewPalette: [
      'hsl(220,14.75%,11.96%)',
      'hsl(197.14,6.93%,19.8%)',
      'hsl(246.91,74.33%,63.33%)',
      'hsl(0,0%,89.8%)',
    ],
    colors: {
      background: '220.0000 14.7541% 11.9608%',
      foreground: '0 0% 89.8039%',
      primary: '246.9065 74.3316% 63.3333%',
      primaryForeground: '0 0% 100%',
      secondary: '274.6154 100% 25.4902%',
      secondaryForeground: '0 0% 89.8039%',
      accent: '218.5401 79.1908% 66.0784%',
      accentForeground: '0 0% 89.8039%',
      card: '197.1429 6.9307% 19.8039%',
      cardForeground: '0 0% 89.8039%',
      popover: '197.1429 6.9307% 19.8039%',
      popoverForeground: '0 0% 89.8039%',
      muted: '0 0% 26.6667%',
      mutedForeground: '0 0% 63.9216%',
      destructive: '0 84.2365% 60.1961%',
      destructiveForeground: '0 0% 100%',
      border: '0 0% 26.6667%',
      input: '0 0% 26.6667%',
      ring: '246.9065 74.3316% 63.3333%',
      chart1: '246.9065 74.3316% 63.3333%',
      chart2: '282.2857 43.5685% 47.2549%',
      chart3: '274.6154 100% 25.4902%',
      chart4: '218.5401 79.1908% 66.0784%',
      chart5: '207.2727 44% 49.0196%',
      sidebar: '220.0000 14.7541% 11.9608%',
      sidebarForeground: '0 0% 89.8039%',
      sidebarPrimary: '246.9065 74.3316% 63.3333%',
      sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '218.5401 79.1908% 66.0784%',
      sidebarAccentForeground: '0 0% 89.8039%',
      sidebarBorder: '0 0% 26.6667%',
      sidebarRing: '246.9065 74.3316% 63.3333%',
    },
    fonts: {
      sans: "'Montserrat', sans-serif",
      mono: "'Source Code Pro', monospace",
    },
    radius: '0.5rem',
    shadow: {
      x: '0px',
      y: '1px',
      blur: '2px',
      spread: '0px',
      opacity: '0.05',
      color: '#000000',
    },
  },

  notebook: {
    id: 'notebook',
    name: 'Notebook',
    previewPalette: [
      'hsl(0,0%,97.65%)',
      'hsl(47.44,64.18%,86.86%)',
      'hsl(0,0%,37.65%)',
      'hsl(0,0%,22.75%)',
    ],
    colors: {
      background: '0 0% 97.6471%',
      foreground: '0 0% 22.7451%',
      primary: '0 0% 37.6471%',
      primaryForeground: '0 0% 94.1176%',
      secondary: '0 0% 87.0588%',
      secondaryForeground: '0 0% 22.7451%',
      accent: '47.4419 64.1791% 86.8627%',
      accentForeground: '14.2105 25.6757% 29.0196%',
      card: '0 0% 100%',
      cardForeground: '0 0% 22.7451%',
      popover: '0 0% 100%',
      popoverForeground: '0 0% 22.7451%',
      muted: '0 0% 89.0196%',
      mutedForeground: '0 0% 31.3725%',
      destructive: '0 41.4894% 63.1373%',
      destructiveForeground: '0 0% 100%',
      border: '0 0.8696% 45.0980%',
      input: '0 0% 100%',
      ring: '0 0% 62.7451%',
      chart1: '0 0% 20%',
      chart2: '0 0% 33.3333%',
      chart3: '0 0% 46.6667%',
      chart4: '0 0% 60%',
      chart5: '0 0% 73.3333%',
      sidebar: '0 0% 94.1176%',
      sidebarForeground: '0 0% 22.7451%',
      sidebarPrimary: '0 0% 37.6471%',
      sidebarPrimaryForeground: '0 0% 94.1176%',
      sidebarAccent: '47.4419 64.1791% 86.8627%',
      sidebarAccentForeground: '14.2105 25.6757% 29.0196%',
      sidebarBorder: '0 0% 75.2941%',
      sidebarRing: '0 0% 62.7451%',
    },
    fonts: {
      sans: "'Architects Daughter', sans-serif",
      mono: "'Courier New', monospace",
    },
    radius: '0.625rem',
    shadow: {
      x: '1px',
      y: '4px',
      blur: '5px',
      spread: '0px',
      opacity: '0.03',
      color: '#000000',
    },
  },

  sunset: {
    id: 'sunset',
    name: 'Sunset',
    previewPalette: [
      'hsl(24,100%,98.04%)',
      'hsl(26.11,98.5%,73.92%)',
      'hsl(11.63,100%,68.63%)',
      'hsl(346.67,7.96%,22.16%)',
    ],
    colors: {
      background: '24.0000 100.0000% 98.0392%',
      foreground: '346.6667 7.9646% 22.1569%',
      primary: '11.6250 100% 68.6275%',
      primaryForeground: '0 0% 100%',
      secondary: '8.5714 100.0000% 95.8824%',
      secondaryForeground: '9.9130 47.3251% 47.6471%',
      accent: '26.1069 98.4962% 73.9216%',
      accentForeground: '346.6667 7.9646% 22.1569%',
      card: '0 0% 100%',
      cardForeground: '346.6667 7.9646% 22.1569%',
      popover: '0 0% 100%',
      popoverForeground: '346.6667 7.9646% 22.1569%',
      muted: '15.0000 100.0000% 96.0784%',
      mutedForeground: '25.0000 5.2632% 44.7059%',
      destructive: '355.4913 77.5785% 56.2745%',
      destructiveForeground: '0 0% 100%',
      border: '14.6341 100.0000% 91.9608%',
      input: '14.6341 100.0000% 91.9608%',
      ring: '11.6250 100% 68.6275%',
      chart1: '11.6250 100% 68.6275%',
      chart2: '26.1069 98.4962% 73.9216%',
      chart3: '23.8636 100.0000% 82.7451%',
      chart4: '16.0714 100% 78.0392%',
      chart5: '9.5798 54.8387% 57.4510%',
      sidebar: '15.0000 100.0000% 96.0784%',
      sidebarForeground: '346.6667 7.9646% 22.1569%',
      sidebarPrimary: '11.6250 100% 68.6275%',
      sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '26.1069 98.4962% 73.9216%',
      sidebarAccentForeground: '346.6667 7.9646% 22.1569%',
      sidebarBorder: '14.6341 100.0000% 91.9608%',
      sidebarRing: '11.6250 100% 68.6275%',
    },
    fonts: {
      sans: "'Montserrat', sans-serif",
      mono: "'Ubuntu Mono', monospace",
    },
    radius: '0.625rem',
    shadow: {
      x: '0px',
      y: '6px',
      blur: '12px',
      spread: '-3px',
      opacity: '0.09',
      color: '#000000',
    },
  },

  'doom-64': {
    id: 'doom-64',
    name: 'Doom 64',
    previewPalette: [
      'hsl(0,0%,10.2%)',
      'hsl(1.36,77.19%,55.29%)',
      'hsl(92.04,47.91%,42.16%)',
      'hsl(206.71,89.02%,67.84%)',
    ],
    colors: {
      background: '0 0% 10.1961%',
      foreground: '0 0% 87.8431%',
      primary: '1.3636 77.1930% 55.2941%',
      primaryForeground: '0 0% 100%',
      secondary: '92.0388 47.9070% 42.1569%',
      secondaryForeground: '0 0% 0%',
      accent: '206.7123 89.0244% 67.8431%',
      accentForeground: '0 0% 0%',
      card: '0 0% 16.4706%',
      cardForeground: '0 0% 87.8431%',
      popover: '0 0% 16.4706%',
      popoverForeground: '0 0% 87.8431%',
      muted: '0 0% 14.5098%',
      mutedForeground: '0 0% 62.7451%',
      destructive: '37.6471 100% 50%',
      destructiveForeground: '0 0% 0%',
      border: '0 0% 29.0196%',
      input: '0 0% 29.0196%',
      ring: '1.3636 77.1930% 55.2941%',
      chart1: '1.3636 77.1930% 55.2941%',
      chart2: '92.0388 47.9070% 42.1569%',
      chart3: '206.7123 89.0244% 67.8431%',
      chart4: '37.6471 100% 50%',
      chart5: '15.8824 15.3153% 56.4706%',
      sidebar: '0 0% 7.8431%',
      sidebarForeground: '0 0% 87.8431%',
      sidebarPrimary: '1.3636 77.1930% 55.2941%',
      sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '206.7123 89.0244% 67.8431%',
      sidebarAccentForeground: '0 0% 0%',
      sidebarBorder: '0 0% 29.0196%',
      sidebarRing: '1.3636 77.1930% 55.2941%',
    },
    fonts: {
      sans: "'Oxanium', sans-serif",
      mono: "'Source Code Pro', monospace",
    },
    radius: '0px',
    shadow: {
      x: '0px',
      y: '2px',
      blur: '5px',
      spread: '0px',
      opacity: '0.6',
      color: '#000000',
    },
  },

  pink: {
    id: 'pink',
    name: 'Pink',
    previewPalette: [
      'hsl(300,33.33%,97.06%)',
      'hsl(314.67,61.64%,85.69%)',
      'hsl(333.27,42.98%,46.08%)',
      'hsl(296,55.56%,21.18%)',
    ],
    colors: {
      background: '300 33.3333% 97.0588%',
      foreground: '296 55.5556% 21.1765%',
      primary: '333.2673 42.9787% 46.0784%',
      primaryForeground: '0 0% 100%',
      secondary: '314.6667 61.6438% 85.6863%',
      secondaryForeground: '295.8333 40.9091% 34.5098%',
      accent: '314.6667 61.6438% 85.6863%',
      accentForeground: '295.8333 40.9091% 34.5098%',
      card: '300 33.3333% 97.0588%',
      cardForeground: '296 55.5556% 21.1765%',
      popover: '0 0% 100%',
      popoverForeground: '296 55.5556% 21.1765%',
      muted: '310.5882 48.5714% 93.1373%',
      mutedForeground: '295.5224 32.6829% 40.1961%',
      destructive: '357.6923 43.6975% 46.6667%',
      destructiveForeground: '0 0% 100%',
      border: '304.8000 60.9756% 83.9216%',
      input: '317.3684 44.1860% 83.1373%',
      ring: '333.3333 71.4286% 50.5882%',
      chart1: '318.4358 70.1961% 50%',
      chart2: '272.3353 82.2660% 39.8039%',
      chart3: '197.3333 36.5854% 24.1176%',
      chart4: '43.1250 73.5632% 65.8824%',
      chart5: '27.1233 86.9048% 67.0588%',
      sidebar: '290.0000 50% 92.9412%',
      sidebarForeground: '327.2000 77.3196% 38.0392%',
      sidebarPrimary: '240 9.8039% 30%',
      sidebarPrimaryForeground: '320.0000 47.3684% 96.2745%',
      sidebarAccent: '60 6.6667% 97.0588%',
      sidebarAccentForeground: '240 9.8039% 30%',
      sidebarBorder: '20.0000 7.3171% 91.9608%',
      sidebarRing: '333.3333 71.4286% 50.5882%',
    },
    fonts: {
      sans: "'Inter', 'Helvetica Neue', sans-serif",
      mono: "'Courier New', monospace",
    },
    radius: '0.5rem',
    shadow: {
      x: '0',
      y: '1px',
      blur: '3px',
      spread: '0px',
      opacity: '0.1',
      color: '#000000',
    },
  },

  graphite: {
    id: 'graphite',
    name: 'Graphite',
    previewPalette: [
      'hsl(0,0%,10.2%)',
      'hsl(0,0%,25.1%)',
      'hsl(0,0%,62.75%)',
      'hsl(0,0%,85.1%)',
    ],
    colors: {
      background: '0 0% 10.1961%',
      foreground: '0 0% 85.0980%',
      primary: '0 0% 62.7451%',
      primaryForeground: '0 0% 10.1961%',
      secondary: '0 0% 18.8235%',
      secondaryForeground: '0 0% 85.0980%',
      accent: '0 0% 25.0980%',
      accentForeground: '0 0% 85.0980%',
      card: '0 0% 12.5490%',
      cardForeground: '0 0% 85.0980%',
      popover: '0 0% 12.5490%',
      popoverForeground: '0 0% 85.0980%',
      muted: '0 0% 16.4706%',
      mutedForeground: '0 0% 50.1961%',
      destructive: '0 66.3043% 63.9216%',
      destructiveForeground: '0 0% 100%',
      border: '0 0% 20.7843%',
      input: '0 0% 18.8235%',
      ring: '0 0% 62.7451%',
      chart1: '0 0% 62.7451%',
      chart2: '187.0588 15.1786% 56.0784%',
      chart3: '0 0% 43.9216%',
      chart4: '0 0% 34.5098%',
      chart5: '0 0% 25.0980%',
      sidebar: '0 0% 12.1569%',
      sidebarForeground: '0 0% 85.0980%',
      sidebarPrimary: '0 0% 62.7451%',
      sidebarPrimaryForeground: '0 0% 10.1961%',
      sidebarAccent: '0 0% 25.0980%',
      sidebarAccentForeground: '0 0% 85.0980%',
      sidebarBorder: '0 0% 20.7843%',
      sidebarRing: '0 0% 62.7451%',
    },
    fonts: {
      sans: "'Inter', 'Helvetica Neue', sans-serif",
      mono: "'Fira Code', monospace",
    },
    radius: '0.35rem',
    shadow: {
      x: '0px',
      y: '2px',
      blur: '0px',
      spread: '0px',
      opacity: '0.15',
      color: '#333333',
    },
  },
};

const THEME_IDS = Object.keys(THEMES);

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(
        result[3],
        16,
      )}`
    : '0 0 0';
}

function applyTheme(themeId: string) {
  const theme = THEMES[themeId];
  if (!theme) return;

  const root = document.documentElement;
  const { colors, fonts, radius, shadow } = theme;

  root.style.setProperty('--background', colors.background);
  root.style.setProperty('--foreground', colors.foreground);
  root.style.setProperty('--card', colors.card);
  root.style.setProperty('--card-foreground', colors.cardForeground);
  root.style.setProperty('--popover', colors.popover);
  root.style.setProperty('--popover-foreground', colors.popoverForeground);
  root.style.setProperty('--primary', colors.primary);
  root.style.setProperty('--primary-foreground', colors.primaryForeground);
  root.style.setProperty('--secondary', colors.secondary);
  root.style.setProperty('--secondary-foreground', colors.secondaryForeground);
  root.style.setProperty('--muted', colors.muted);
  root.style.setProperty('--muted-foreground', colors.mutedForeground);
  root.style.setProperty('--accent', colors.accent);
  root.style.setProperty('--accent-foreground', colors.accentForeground);
  root.style.setProperty('--destructive', colors.destructive);
  root.style.setProperty(
    '--destructive-foreground',
    colors.destructiveForeground,
  );
  root.style.setProperty('--border', colors.border);
  root.style.setProperty('--input', colors.input);
  root.style.setProperty('--ring', colors.ring);
  root.style.setProperty('--chart-1', colors.chart1);
  root.style.setProperty('--chart-2', colors.chart2);
  root.style.setProperty('--chart-3', colors.chart3);
  root.style.setProperty('--chart-4', colors.chart4);
  root.style.setProperty('--chart-5', colors.chart5);
  root.style.setProperty('--sidebar-background', colors.sidebar);
  root.style.setProperty('--sidebar-foreground', colors.sidebarForeground);
  root.style.setProperty('--sidebar-primary', colors.sidebarPrimary);
  root.style.setProperty(
    '--sidebar-primary-foreground',
    colors.sidebarPrimaryForeground,
  );
  root.style.setProperty('--sidebar-accent', colors.sidebarAccent);
  root.style.setProperty(
    '--sidebar-accent-foreground',
    colors.sidebarAccentForeground,
  );
  root.style.setProperty('--sidebar-border', colors.sidebarBorder);
  root.style.setProperty('--sidebar-ring', colors.sidebarRing);
  root.style.setProperty('--font-sans', fonts.sans);
  root.style.setProperty('--font-mono', fonts.mono);
  root.style.setProperty('--radius', radius);
  root.style.setProperty('--shadow-x', shadow.x);
  root.style.setProperty('--shadow-y', shadow.y);
  root.style.setProperty('--shadow-blur', shadow.blur);
  root.style.setProperty('--shadow-spread', shadow.spread);
  root.style.setProperty('--shadow-opacity', shadow.opacity);
  root.style.setProperty('--shadow-color', shadow.color);
  root.style.setProperty('--shadow-rgb', hexToRgb(shadow.color));
}

/**
 * This component is not meant to be consumed by Zite generated code, but just there
 * to help developing components and testing them with the different Zite themes.
 * @internal
 */
export function ThemeSwitcher() {
  const [activeTheme, setActiveTheme] = useState('default');
  const [radius, setRadius] = useState(0.5);

  function handleSelect(id: string) {
    setActiveTheme(id);
    applyTheme(id);
    setRadius(parseFloat(THEMES[id].radius));
  }

  function handleRadiusChange([value]: number[]) {
    setRadius(value);
    document.documentElement.style.setProperty('--radius', `${value}rem`);
  }

  return (
    <Collapsible className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <Select value={activeTheme} onValueChange={handleSelect}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THEME_IDS.map(id => {
              const theme = THEMES[id];
              return (
                <SelectItem key={id} value={id}>
                  <div className="flex items-center gap-2">
                    <div className="flex h-3.5 w-8 overflow-hidden rounded-sm shrink-0">
                      {theme.previewPalette.map((color, i) => (
                        <div
                          key={i}
                          className="flex-1"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                    {theme.name}
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-3 w-48">
          <span className="text-sm text-muted-foreground shrink-0">Radius</span>
          <Slider
            min={0}
            max={3}
            step={0.05}
            value={[radius]}
            onValueChange={handleRadiusChange}
          />
          <span className="text-sm text-muted-foreground w-10 shrink-0">
            {radius.toFixed(2)}
          </span>
        </div>

        <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground [&[data-state=open]>svg]:rotate-180">
          <ChevronDown className="size-4 transition-transform duration-200" />
          Colors
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        <div className="columns-[200px] space-y-1">
          {COLOR_VARS.map(variable => (
            <div
              key={variable}
              className="flex items-center gap-2 py-0.5 break-inside-avoid"
            >
              <div
                className="size-6 shrink-0 rounded-sm border border-border"
                style={{ backgroundColor: `hsl(var(${variable}))` }}
              />
              <span className="text-xs text-muted-foreground font-mono truncate">
                {variable}
              </span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
