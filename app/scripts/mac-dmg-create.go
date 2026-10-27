// Derived from JetBrains go-dmg-writer dmg.go (Apache-2.0); ZIP input adapter.
package dmg
import("archive/zip";"bytes";"fmt";"io";"os";"path/filepath";"time";"github.com/jetbrains/go-dmg-writer/internal/gpt";"github.com/jetbrains/go-dmg-writer/internal/hfsplus";"github.com/jetbrains/go-dmg-writer/internal/udif")
func (d *DMG) CreateFromZIP(srcZIP, outPath string, mode Mode) (err error) {
	switch mode {
	case ModeReadOnly, ModeReadOnlyCompressed:
		// ok
	default:
		return fmt.Errorf("dmg: invalid Mode %s", mode)
	}

	z, err := zip.OpenReader(srcZIP)
	if err != nil { return err }; defer z.Close()

	when := d.Time
	if when.IsZero() {
		when = time.Now().UTC()
	}
	macTime := hfsplus.MacTime(when)
	if macTime == 0 {
		macTime = 1 // fsck rejects zero
	}

	ownerID := d.OwnerID
	if ownerID == OwnerIDUnset {
		ownerID = hfsPlusUnknownUser
	}
	groupID := d.GroupID
	if groupID == OwnerIDUnset {
		groupID = hfsPlusUnknownUser
	}

	volName := d.VolumeName
	if volName == "" {
		volName = "disk image"
	}

	// Walk the source folder, assigning CNIDs and collecting xattrs.
	scan, err := walkZIP(z, macTime, ownerID, groupID, volName)
	if err != nil {
		return err
	}

	// Optionally, attach RootFinderInfo as a xattr on the root folder.
	if d.RootFinderInfo != nil {
		if got := len(d.RootFinderInfo); got != 32 {
			return fmt.Errorf("dmg: RootFinderInfo must be exactly 32 bytes (got %d)", got)
		}
		scan.attrs = append(scan.attrs, hfsplus.Attr{
			FileID: hfsplus.CNIDRootFolder,
			Name:   hfsplus.FinderInfoAttr,
			Data:   append([]byte(nil), d.RootFinderInfo...),
		})
	}

	// Build the HFS+ image into a scratch file. It holds the entire
	// uncompressed volume, so it goes next to the output rather than in
	// TMPDIR unless the caller says otherwise; see [DMG.TempDir].
	tempDir := d.TempDir
	if tempDir == "" {
		tempDir = filepath.Dir(outPath)
	}
	scratch, err := os.CreateTemp(tempDir, "go-dmg-*.hfs")
	if err != nil {
		return fmt.Errorf("dmg: scratch file in %q: %w", tempDir, err)
	}
	defer func() {
		_ = scratch.Close()
		_ = os.Remove(scratch.Name())
	}()

	inputs := &hfsplus.VolumeInputs{
		Entries:   scan.entries,
		UserFiles: scan.files,
		Attrs:     scan.attrs,
		BlockSize: d.BlockSize,
		MacTime:   macTime,
	}
	volumeSize, err := hfsplus.WriteVolume(scratch, inputs)
	if err != nil {
		return fmt.Errorf("dmg: build hfs+ image: %w", err)
	}

	// Rewind the scratch file and wrap it as UDIF.
	if _, err := scratch.Seek(0, io.SeekStart); err != nil {
		return err
	}

	// The partition map goes between the volume and the UDIF wrapper.
	// Derive it before the output file exists, so a volume size the map
	// cannot describe leaves no truncated file behind (and does not
	// clobber a good image from a previous run).
	var layout gpt.Layout
	if d.PartitionMap {
		layout, err = gpt.New(volumeSize, volName, when)
		if err != nil {
			return fmt.Errorf("dmg: partition map: %w", err)
		}
	}

	out, err := os.Create(outPath)
	if err != nil {
		return fmt.Errorf("dmg: open output: %w", err)
	}
	// Capture the close error so a flush failure here doesn't silently
	// produce a corrupt DMG.
	defer func() {
		if cerr := out.Close(); cerr != nil && err == nil {
			err = fmt.Errorf("dmg: close output: %w", cerr)
		}
	}()

	udifMode := udif.CompressionNone
	if mode == ModeReadOnlyCompressed {
		udifMode = udif.CompressionZlib
	}

	udifOpts := udif.Options{
		VolumeName:   volName,
		Compression:  udifMode,
		ChunkSectors: d.ChunkSectors,
		Time:         when,
	}

	// udif.Write takes an io.Reader, so the two halves of the map stream
	// in front of and behind the scratch file. There is no second pass
	// and no second scratch file.
	//
	// The scratch reader is capped at volumeSize: the geometry the map
	// describes is authoritative, and io.MultiReader would otherwise read
	// the file to EOF, so a scratch file longer than the volume it
	// reports would push the trailing map off its sector.
	var src io.Reader = io.LimitReader(scratch, int64(volumeSize))
	srcLen := int64(volumeSize)
	if d.PartitionMap {
		src = io.MultiReader(bytes.NewReader(layout.LeadingMap()), src, bytes.NewReader(layout.TrailingMap()))
		srcLen = int64(layout.DiskSize())

		// The resource fork has to describe the framed disk span by
		// span. Without this the image carries one blkx table that
		// calls the whole disk a filesystem, and a reader that trusts
		// it starts reading the protective MBR as a volume header.
		for _, r := range layout.Regions() {
			udifOpts.Regions = append(udifOpts.Regions, udif.Region{
				Name:        r.Name,
				Type:        r.Type,
				SectorCount: r.Sectors,
			})
		}
	}

	if err := udif.Write(out, src, srcLen, udifOpts); err != nil {
		return fmt.Errorf("dmg: wrap udif: %w", err)
	}
	return nil
}

