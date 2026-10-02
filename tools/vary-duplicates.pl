#!/usr/bin/perl
# Make duplicated slip target maps slightly different (dataset from tools/bmwrc25-to-js.pl).
#   perl tools/vary-duplicates.pl js/dataset.js [step] > out.js      (step default 0.025)
# Per group of identical maps the first one (lowest id) stays; the others become
# x (1 + k * step), k = 1, 2, ... (rounded to 0.1 %, max 20 %). Each gets a note.
use strict;
use warnings;

my ($file, $step) = @ARGV;
die "usage: $0 dataset.js [step]\n" unless $file;
$step ||= 0.025;
open my $h, '<', $file or die "$file: $!\n";
my $s = do { local $/; <$h> };

my (%group, %rowsOf);
while ($s =~ /\{ id: (\d+), lean: \[[^\]]*\], rows: (\[.*?\]\])/g) { push @{ $group{$2} }, $1; $rowsOf{$1} = $2 }

my @log;
for my $ids (values %group) {
  my @ids = sort { $a <=> $b } @$ids;
  next if @ids < 2;
  my $base = shift @ids;
  my $k = 0;
  for my $id (@ids) {
    $k++;
    my $f = 1 + $k * $step;
    (my $rows = $rowsOf{$id}) =~ s/(-?\d+(?:\.\d+)?)/my $v = $1 * $f; $v = 20 if $v > 20; sprintf('%g', int($v * 10 + 0.5) \/ 10)/ge;
    my $note = sprintf 'Map %d x %.3f', $base, $f;
    $s =~ s/(\{ id: $id, lean: \[[^\]]*\], rows: )\[.*?\]\]((?:, [a-z]+: "[^"]*")*)( \})/$1$rows$2, note: "$note"$3/;
    push @log, "Map $id <- $note";
  }
}
$s =~ s/^(window\.MRCK_DATASET)/join('', map { "\/\/ $_\n" } @log) . $1/me;
print $s;
print STDERR "$_\n" for @log;
