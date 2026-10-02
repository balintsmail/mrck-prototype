#!/usr/bin/perl
# Order the slip target maps of a dataset (js/dataset.js) from the smallest to the largest.
#   perl tools/order-maps.pl js/dataset.js > ordered.js
# Size = mean slip target over all mu rows and lean 0..70 deg (1 deg steps, linear, ends held).
# The allocation is renumbered so every mode / gear keeps the same map; each map notes its old number.
use strict;
use warnings;

my $file = shift or die "usage: $0 dataset.js\n";
open my $h, '<', $file or die "$file: $!\n";
my $s = do { local $/; <$h> };

my @maps;
while ($s =~ /\{ id: (\d+), lean: \[([^\]]*)\], rows: (\[.*?\]\])((?:, [a-z]+: "[^"]*")*) \}/g) {
  my ($id, $lean, $rows, $extra) = ($1, $2, $3, $4);
  my @lean = split /,/, $lean;
  my @rows = map { [ split /,/ ] } ($rows =~ /\[([^\[\]]*)\]/g);
  push @maps, { id => $id, lean => $lean, rowsTxt => $rows, extra => $extra, size => size(\@lean, \@rows) };
}
sub at {                                   # lean is descending
  my ($l, $v, $x) = @_;
  return $v->[0] if $x >= $l->[0];
  return $v->[-1] if $x <= $l->[-1];
  for my $i (0 .. $#$l - 1) {
    next unless $x <= $l->[$i] && $x >= $l->[$i + 1];
    return $v->[$i] + ($v->[$i + 1] - $v->[$i]) * ($l->[$i] - $x) / ($l->[$i] - $l->[$i + 1]);
  }
}
# Size profile: mean over all mu rows at lean 0, 5, 10 ... 70 deg (small lean first).
sub size {
  my ($l, $rows) = @_;
  return [ map { my $x = $_ * 5; my $sum = 0; $sum += at($l, $_, $x) for @$rows; $sum / @$rows } 0 .. 14 ];
}
# Smallest values at small lean angle first; ties are decided at the next lean angle up.
sub cmpSize {
  my ($p, $q) = @_;
  for my $i (0 .. $#$p) { my $d = $p->[$i] - $q->[$i]; return $d < 0 ? -1 : 1 if abs($d) > 1e-6 }
  return 0;
}
my @order = sort { cmpSize($a->{size}, $b->{size}) || $a->{id} <=> $b->{id} } @maps;
my %newId; $newId{ $order[$_]{id} } = $_ + 1 for 0 .. $#order;

my @out;
for my $i (0 .. $#order) {
  my $m = $order[$i];
  my $extra = $m->{extra};
  $extra =~ s/, was: "[^"]*"//;
  push @out, sprintf('{ id: %d, lean: [%s], rows: %s%s, was: "Map %d" }', $i + 1, $m->{lean}, $m->{rowsTxt}, $extra, $m->{id});
  printf STDERR "Map %2d <- was Map %2d   mean slip at lean 15/20/30/45/60: %s\n", $i + 1, $m->{id},
    join(' / ', map { sprintf '%.2f', $m->{size}[$_] } 3, 4, 6, 9, 12);
}
$s =~ s/  targets: \[\n.*?\n  \],/"  targets: [\n    " . join(",\n    ", @out) . ",\n  ],"/se;
# renumber the allocation: every [..] list on the allocation line
my @lines = split /\n/, $s, -1;
for (@lines) {
  next unless /^\s*allocation: /;
  s/\[([^\]]*)\]/'[' . join(',', map { $newId{$_} } split(\/,\/, $1)) . ']'/ge;
}
$s = join "\n", @lines;
$s =~ s/^(window\.MRCK_DATASET)/\/\/ Maps ordered: smallest slip targets at small lean angle first; allocation renumbered.\n$1/m;
print $s;
